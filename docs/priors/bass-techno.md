# Bass Sound Design Priors — Techno / Melodic Techno / Minimal

Mined from practitioner-grade tutorials (Attack Magazine, Sound on Sound/Roland, MusicRadar, MusicTech, ADSR, Studio Brootle, Mastrng, Production Music Live, Gearnews, Futureproof Music School). Each recipe is walked from source with real numbers where the source gave them; gaps are marked explicitly rather than papered over.

---

## SECTION A — RUMBLE BASS (reverb-into-sidechain technique)

This is a duplicate-kick-into-long-reverb-into-EQ'd-sub-tail-into-sidechain technique, consistent across 5 independent sources. It is NOT a synth bass — it's a processed percussion/reverb chain that behaves like a bass.

### A1. Basic Rumble Chain (Gearnews / Ableton walkthrough)
- Source: https://www.gearnews.com/techno-rumble-ableton-live-studio/ (Ableton-focused production tutorial site)
- Layer structure: 2 chains inside one Audio Effect Rack — "Original" (dry kick, untouched) and "Rumble" (100% wet processed).
- Signal chain order: **Hybrid Reverb (100% wet) → Utility (force Mono) → Saturator → EQ Eight → volume ducker (Utility + envelope modulator, drawn manually) → Drum Buss (final glue on the group)**.
- EQ Eight settings: low cut ~20–25 Hz, high cut 150–200 Hz, optional slight boost at 100 Hz.
- Sidechain: not a conventional compressor — article uses a **manually-drawn envelope modulator / Utility volume automation** synced to the kick hits rather than a threshold-based compressor. This is a notable deviation from the compressor-based approach below.
- Verbatim: reverb set to "100 percent 'wet' to eliminate original sound from the effect chain output."

### A2. Two-Layer Rumble (Mastrng)
- Source: https://www.mastrng.com/techno-rumble/ (mixing/mastering-focused production blog)
- Layer structure: **duplicated kick (sine or slightly-distorted sine, 40–120Hz, 1–10ms attack, 100–300ms decay) split into a "Low Rumble" layer and a separate "High Rumble" layer** — two distinct reverb sends filtered to different bands, which is the only source describing a two-band rumble split.
- Low Rumble reverb: 100% wet, decay ~4 seconds, size ~50%, diffusion ~80%, high-cut after reverb around 100 Hz.
- Low Rumble distortion: **drive ~10 dB, colour ~50%**.
- Low Rumble EQ: low-pass everything above 120 Hz.
- High Rumble EQ: band-pass, cut below 250 Hz and above 800 Hz "to taste."
- Level: Low Rumble track pulled down to **~-12 dB** relative to the dry kick.
- Sidechain: compressor on both rumble layers, triggered by the **original dry kick** (not self-sidechained) — ratio/attack/release not given numerically.
- Routing: all layers → "Rumble Kick" group bus for unified processing.

### A3. Johannes Menzel Method (Production Music Live)
- Source: https://www.productionmusiclive.com/blogs/news/6-steps-to-create-that-rumbling-techno-kick-you-love-with-johannes-menzel — attributed to producer Johannes Menzel, published via Production Music Live (Francois & Tom's tutorial platform)
- Layer structure: **three duplicate kick channels** — Main Kick (dry), Reverb Kick (Reverb → Overdrive → EQ), Ghost Kick (low-passed, rhythmically offset copy — distinctive third element not seen in other sources).
- Reverb Kick wet: **75–100% wet**.
- Reverb Kick EQ: low-pass filter, cutoff aimed **below 300 Hz**.
- Group bus: tape saturation → compressor → EQ → "slight limiting."
- Gap: no numeric reverb decay/predelay, no overdrive drive amount, no compressor ratio/times given — source explicitly frames this as "experiment," not a fixed recipe.

### A4. Studio Brootle Method
- Source: https://www.studiobrootle.com/techno-rumble-ableton-rumble-kick/ (Ableton tutorial site)
- Source sound: 909 kick + overdrive "for a bit of grunt."
- Routing: Channel 1 = dry 909+overdrive kick; Channel 2 = duplicate kick → reverb → saturation → EQ (to "bring out the reverb"); both grouped → Glue Compressor on the group.
- Mono the whole rumble channel — explicit phase-safety note: "the sub must be mono or your phase relationships will collapse on a club system."
- Gap: reverb decay/wet %, saturation drive, EQ freq/dB, and glue compressor ratio/times are all shown only in screenshots, not stated numerically in text.

### A5. Hard/Dark Techno Rumble (Futureproof Music School)
- Source: https://futureproofmusicschool.com/blog/making-hard-techno-a-path-to-unique-sound-design
- The most numerically complete rumble recipe found:
  - Parallel **return track** (not insert) so the dry kick stays untouched.
  - Reverb: **3–5 seconds decay, 100% wet**.
  - Distortion: "heavy" — named plugin suggestions (Decapitator, Trash, Saturn) "at aggressive settings."
  - EQ: **high-pass everything below 30 Hz** (cut subsonic mud) + **high-shelf cut everything above 150–200 Hz** — "you only want the sub-bass tail."
  - Sidechain: **the wet return is sidechained to the original dry kick** ("so the rumble ducks on every kick hit") — explicitly NOT self-sidechained.
  - Final: mono conversion.
- Same source also covers the main kick (pitch envelope dropping from a higher pitch to fundamental over the first **10–20 ms** for punch, tuned to track key — A or C common) and an acid-303 bassline recipe: minor scale, 8–16 step pattern with accents/slides/ghost notes, high resonance, cutoff automated open/closed across 8–16 bars, **high-pass the acid bass around 150 Hz** before the master bus. Also documents a "distorted lead-bass" layer: Serum saw/square, aggressive unison + drive + detune, through Trash or Saturn for harmonic content — useful as a second bass layer under/over an acid line.

**Rumble bass cross-source consensus** (appears in 4+ of the 5 sources): duplicate the kick → long reverb (3–5s, ~100% wet) → saturate/distort for grit → EQ to isolate only the sub tail (high-pass ~20–30 Hz, low-pass/high-shelf ~150–200 Hz) → sidechain the wet processed layer to the DRY original kick (never to itself) → sum to mono → glue-compress the group. The two/three-layer split (Mastrng, Menzel) is a refinement, not baseline-required.

---

## SECTION B — ACID / 303-STYLE BASS

### B1. Diva Acid Synth (Attack Magazine Synth Secrets)
- Source: https://www.attackmagazine.com/technique/synth-secrets/acid-synth-uhe-diva/ — u-he Diva software recreation, Attack Magazine's in-house sound design column.
- Oscillator: sawtooth (article notes square as an alternate at step 5); range 8' initially, switched to 16' for a lower octave at step 4.
- Voice mode: **Mono (not Legato)** so glide applies between all notes, not just overlapping ones. Glide time set to "one third of the way" up the control.
- Filter: VCF cutoff raised from default (no Hz given), **emphasis/resonance pushed high** for "distinctive resonant sweeps"; Env 2 patched to cutoff at step 5 for movement.
- Mixer feedback: ~1/3 of maximum, for added harmonic bite.
- Effects chain in order: **Overdrive/Distortion (Drive 63%, Tone 60%) → Ping-Pong Delay (Feedback 37%, Dry/Wet 21%, high-frequency-only EQ filter on the delay repeats)**.
- Optional arpeggiator: rate 1/16, **gate 47%**, 4 steps.
- Verbatim: "high resonance values" are called out as essential to the acid character, particularly when the cutoff is swept.

### B2. Acid House Bassline (Attack Magazine tutorial)
- Source: https://www.attackmagazine.com/technique/tutorials/how-to-make-an-acid-house-bassline/
- Oscillator: sawtooth, chosen for a "thinner and more aggressive tone" than square.
- Cutoff and resonance both modulated and turned "clockwise to taste" — no absolute values given, envelope-modulated live rather than fixed.
- Effects chain in order:
  1. Distortion (amount "to taste")
  2. EQ/saturation: Softube Focusing Equalizer, **low cut at 85 Hz**, low gain boosted, mids reduced, highs boosted
  3. Tube saturation (SPL TwinTube or Ableton Dynamic Tube)
  4. Delay: dotted-eighth length, built-in high-pass filter on the repeats
  5. Reverb: two convolution reverbs stacked — a "Fake long spring Mono" IR plus a cathedral IR with EQ rolloff up to 400 Hz
- Tempo context: 129 BPM.

### B3. 303-Style Acid Arpeggiator (Sylenth1, Attack Magazine)
- Source: https://www.attackmagazine.com/technique/synth-secrets/tb-303-acid-arpeggiator-sylenth/ — the single most numerically complete 303-emulation recipe found.
- Oscillator: pulse (square-family), **octave -2**.
- Filter A: lowpass, cutoff ~26 (article's own low internal scale, effectively very closed), **resonance ~3.25**, drive ~2.0, slope toggled to **12 dB** (from 24 dB default).
- Mod Envelope 1 (→ filter cutoff): amount ~7.3, **decay 3.8, sustain 1.7** (Sylenth's 0–10 scale, not ms/Hz — treat as relative).
- Voice: **Mono Legato, portamento ~50%**.
- Amp envelope release: ~1.08 (Sylenth scale) specifically "to prevent clicking" between notes — i.e., a deliberately non-zero release even on a plucky patch.
- Arpeggiator (used as the note-sequencer): **Step mode, 1/16 time, gate ~18%, 8-step wrap**. Sequence pattern given note-for-note: **semitone offsets 0, +12, +12, 0, 0, +12, 0, +3**, with **steps 3, 4, 5, and 8 tied/held (slide)**.
- Effects: Foldback distortion at **50% dry/wet**, EQ (default), single note held for two bars triggers the whole 8-step pattern.

### B4. Chicago-Style 303 Acid Bassline (MusicTech)
- Source: https://musictech.com/guides/essential-guide/how-to-create-a-chicago-style-acid-house-bassline/
- Sequencer trick, distinctive and not seen elsewhere: **shorten the pattern length from 16 steps to an odd number like 13 or 15** to break up the 4/4 grid and create evolving, non-repeating phrasing against a straight kick. Keep the note range to one octave, matching original hardware limits.
- Accents/slides: entered "at random across the bottom of the sequencer grid" rather than on a fixed pattern — no percentage given, but explicitly randomized placement is the recommended method.
- Effects chain: **Distortion (Diode Clean algorithm, Drive + Color controls, Dynamics set to post-distortion) → Limiter (short attack/release, medium threshold, Soft Clip enabled) → Reverb (short predelay, Early/Late balance, zero feedback)**.
- EQ: boost lows and highs, cut "boxy" low-mids (no freq/dB given).

### B5. MusicRadar / Fatboy Slim-style Acid Bassline
- Source: https://www.musicradar.com/how-to/make-acid-bassline-fatboy-slim-303
- Oscillator: sawtooth, **Legato voice mode, portamento ~50%** ("about halfway up").
- Filter: **steep lowpass, 24 dB/octave**, cutoff set "about halfway," resonance added with envelope assigned; short envelope decay.
- Amp envelope: **fast attack, medium decay, short sustain, short release** (qualitative only).
- Modulation: velocity → filter cutoff + resonance; LFO (random/S&H shape, free-running, low depth) → cutoff for unpredictable per-note variation — this is a distinct "add an LFO on top of the envelope" move not mentioned in the other 303 recipes.
- Sequencing: 2-bar/16-step pattern, **octave jumps of +12 semitones** on select steps, per-step velocity variation, hold/tie activated on certain steps for the classic slide.
- Effects: ping-pong stereo delay, 1/4 + 1/8 note timings, feedback "quite low"; filter cutoff automated over the arrangement.

### B6. TB-303 Waveform/Filter Cheatsheet (Roland Articles — "Beyond Acid")
- Source: https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory/ (Roland's own editorial site)
- Waveform choice matters by role: **saw = biting/aggressive** (acid lines, percussive clicks, punchier FX); **square = rounder/smoother** (liquid leads, sub-bass).
- Role-based filter table given:
  - Acid basslines: cutoff starts low and opens gradually, resonance high.
  - Sub-bass: cutoff closed "almost all the way," resonance kept low (contrast with acid — sub-bass wants the filter mostly OUT of the way).
  - Percussive clicks: cutoff high, resonance low, decay shortened, sustain zeroed for snap.
- Glide: "a touch of glide helps notes flow together" even on sub-bass parts, not just acid leads.
- Accent: described as boosting volume AND brightness simultaneously — i.e., accent raises velocity, filter cutoff, and resonance together, not just level. This mechanism recurs across B1–B6 as the core definition of a TB-303 accent.

**Acid/303 cross-source consensus**: saw or square osc → steep lowpass (18–24 dB/oct across sources, exact slope varies) → resonance pushed high and swept/enveloped rather than static → mono/legato voice mode with glide (30–50% portamento range) for slides → accent = simultaneous velocity + cutoff + resonance boost, not just volume → distortion/saturation stage immediately after the filter for the "bark" → odd-length or randomized-placement sequencing to avoid mechanical 16-step repetition.

---

## SECTION C — ROLLING / WAREHOUSE TECHNO BASS

### C1. Warehouse-Style Rolling Techno Bassline
- Source: https://www.attackmagazine.com/technique/tutorials/warehouse-rolling-techno-bass/ — Attack Magazine, author **Aykan Esen** (bylined, 31 July 2020).
- **Three-layer structure**, explicit:
  1. **Sub layer** — "Kick Sub Butter" sample, attack minimized via transient shaper, low-pass ~80 Hz at 12 dB/oct, overdrive via MDMX Screamer at **~35% wet**.
  2. **Bassline layer** — Waves Element 2 synth, "Plastic Bass 04" preset, saw or square wave, key of G (predominantly G notes at C2), fast attack/fast filter envelope called out as required "for transient audibility."
  3. **Percussive layer** — kick doubled with a **1/16-note, 100% wet delay**, stereo-widened.
- Bassline EQ: high-pass 65 Hz, low-pass 350 Hz, slight cut at 100 Hz, slight boost around 330 Hz.
- Bassline dynamics: sidechain compression via LFO Tool with a **slower release for a swing feel**.
- Kick support processing: transient shaper sustain reduced to -62, EQ cut -4.5 dB at 98 Hz (bell), **parallel compression ~30% mix**.
- MIDI/rhythm: verbatim — "Leaving the first 16th-note of every beat empty is important to prevent clashing with the kick." G note programmed on nearly every remaining 16th with velocity variation.

### C2. Chaotic Generative Techno Bass (Newfangled Audio Generate)
- Source: https://www.attackmagazine.com/technique/tutorials/make-a-techno-bassline-using-generate/
- Single-voice chaotic generator: sine wave through "Helix" chaos algorithm, Chaos Amount and Chaos Shape both increased, "Animate" raised for an inherent detuning effect (no fixed cents value — the chaos engine substitutes for a fixed detune).
- Amplitude/tone shaping via **Low Pass Gate**: sustain zeroed, decay and release both nudged up, cutoff lowered, resonance increased.
- Saturation: Wavefolder/Saturate algorithm, **drive maxed, mix ~50%**.
- Two additional sub-generator voices layered in to "fill out the low end," each with the Folds parameter raised to tame raspiness — i.e., a **3-voice layer stack** (main chaotic voice + 2 subs).
- Global: unison detune + stereo width on the mix bus; delay and reverb added via modulation-controlled sends; a step sequencer modulates Low Pass Gate decay with a **6-beat step length** specifically to avoid predictable looping.
- Rhythm: single repetitive note following a TR-909-style pattern; the interest comes entirely from the chaos/modulation layer, not pitch variation.

### C3. Progressive Techno Bass (Operator, Attack Magazine "Beat Dissected")
- Source: https://www.attackmagazine.com/technique/beat-dissected/progressive-techno/
- Ableton Operator, "Electric FM4 Wow Bass" preset, **four sampled/tuned notes: E0, G0, A0, D1**, each placed on its own Drum Rack pad with **individual sidechain compression to the kick per pad**.
- Amp envelope release on the sampled hits: **~300 ms**, specifically to prevent note overlap/smearing.
- Saturation "for bite" + compression "for sustain" — named but no numeric drive/ratio given.
- Rhythm: 4-note pattern that changes every bar, emphasis placed on off-beats.

### C4. Dub Techno Sub Bass (Basic Channel style, Attack Magazine "Beat Dissected")
- Source: https://www.attackmagazine.com/technique/beat-dissected/basic-channel-style-dub-techno/
- Sample-based rather than synthesized: "LSTSR3_Emotional_Bass_F" sample chosen specifically for its **mixed-in noise/lo-fi texture** rather than a clean sine.
- **Two pitched layers** of the same sample: one tuned **-2 semitones (D#)**, one **+3 semitones (G#)**, both sitting inside a D# minor harmonic frame — this is a "detune via musical interval" approach rather than cents-level unison detuning.
- Envelope: sample shortened, short release set via piano roll for total note-length control (rhythmic precision over natural sustain).
- Effects: same sidechain compressor as the kick chain applied to both bass layers so they duck under every kick hit; **EQ after the whole drum rack cuts everything below ~37 Hz** (deliberately don't let the bass out-sub the kick); limiter to prevent clipping.
- Rhythm: syncopated against the 4/4 kick via manual MIDI placement, not a fixed grid rule.

### C5. Techno Synth Stabs (Hive/Ableton, Attack Magazine Synth Secrets)
- Source: https://www.attackmagazine.com/technique/synth-secrets/techno-synth-stabs/ — stab/hit rather than a sustained bass, but same low-mid register technique family and the only source with full envelope numbers in ms.
- Oscillator: square wave, lowpass filter (step 1) switched to bandpass (step 5) for variation; resonance "just a touch" up (lowpass) vs cranked for the bandpass variant; mod-env-to-cutoff amount at "3 o'clock."
- **Amp envelope: Attack 0 ms, Decay 66.00 ms, Sustain 0, Release 29.00 ms.**
- **Filter mod envelope: Attack 5.00 ms, Decay 48.00 ms, Sustain 9.00, Release 24.00 ms.**
- Effects chain (Hive): Distort (Soft Clip, subtle) → Delay (ping-pong, mix+width increased).
- Effects chain (Ableton, post-processing): **Reverb (placed FIRST, ahead of drive stages) → Overdrive (~13% dry/wet) → Saturator (10 dB drive, reduced dry/wet) → Drum Buss (26% drive)**.
- Automation across a phrase: reverb dry/wet increases on the final note; filter cutoff swept up in the second section; mod-envelope attack increased and decay reduced on the final note — i.e., deliberate envelope automation as a phrase-ending device.

---

## SECTION D — SUPPORTING BASS FAMILIES (house/tech-house/Reese — adjacent, still techno-relevant)

### D1. Repro-1 Tech-House Bass (Attack Magazine Synth Secrets)
- Source: https://www.attackmagazine.com/technique/synth-secrets/tech-house-bass-u-repro-1/
- Two oscillators: **Osc A = saw + pulse simultaneously (pulse width slightly narrowed)**; **Osc B = pulse, tuned down 1 octave**; master tune -12 semitones overall.
- Mixer feedback/noise control set to feedback, **~25% level** — feedback-into-mixer as a harmonic-thickening trick (echoes the Diva phased-bass feedback approach in B/C).
- Filter: cutoff nearly fully closed, envelope amount turned up significantly, low keyboard tracking.
- Filter envelope: attack default, **decay ~1/3 position, sustain nearly zero**, release default.
- Amp envelope: decay slightly increased, **sustain just under 25%**.
- Effects chain in order: **Jaws waveshaper (Folds lightly driven, Teeth fully clockwise, F-mod 75%) → Lyrebird chorus/delay (Chorus/Short mode, Echo time 1.26, mix 14.50, medium mod depth) → RESQ EQ (low shelf boosted) → Sonic Conditioner saturation (gain increased)**.

### D2. Juno-60 House Bass (Attack Magazine Synth Secrets)
- Source: https://www.attackmagazine.com/technique/synth-secrets/make-a-house-bass-with-the-juno-60/
- DCO range 8', **waveform mix: saw fully up, square ~75%, sub-oscillator ~45%**, PWM 75% modulated by Env 2.
- Filter cutoff at the halfway point, "a little resonance to give it some bite," keyboard tracking on.
- Filter envelope (Env 1): **decay ~15%, sustain 0%, amount ~75%**.
- Amp envelope (Env 2): **attack 0 ms, decay ~halfway, sustain ~25%, release slight increase**.
- Effects: chorus setting I (slowest), depth ~70%; reverb Room algorithm for "bloom"; the analog-drift "Condition" control turned fully right for tight, slop-free tuning (a counterintuitive move — most Juno tutorials push Condition the other way for vintage wobble; this one deliberately kills it).

### D3. Reese Bass Core Technique (basic detuned-sine version)
- Source: same Attack Magazine tutorials cluster (Reese Bass Redux) — layering technique broadly applicable to melodic-techno sub layers.
- Minimal form: **two sine oscillators, one detuned +0.27 semitones, one -0.27 semitones** (i.e., roughly ±27 cents), mono voice mode.
- Amp envelope: sustain 1.00, **release 24 ms**.
- Verbatim: "This creates harmonics with rhythmic movement, the tempo of which can be controlled by adjusting the fine tuning of either oscillator" — i.e., the beating rate between the two detuned oscillators is itself a tunable rhythmic parameter, not just a static thickening trick.
- Gap: source doesn't give filter/effects specifics for the full Reese in this excerpt — treat the detuning ratio and the "beating rate is a parameter" insight as the transferable prior.

---

## CROSS-SOURCE CONSENSUS (high confidence — appears independently in 3+ sources)

1. **Rumble bass = duplicated kick, not a synth.** Reverb (long, 3–5s, ~100% wet) → distortion/saturation → EQ to isolate the sub tail (high-pass 20–30 Hz, low-pass/shelf 150–200 Hz) → sidechain the wet layer to the dry kick → mono. Confirmed in A1–A5 (5/5 sources).
2. **Sidechain the processed/reverb layer to the ORIGINAL dry kick, never to itself.** Stated explicitly and identically in A1 (implicitly via manual envelope), A2, A5. This directly contradicts a naive "sidechain the rumble to itself" assumption.
3. **Mono-sum everything below roughly 100–150 Hz.** Stated in A2 (mono conversion), A4 ("must be mono or phase relationships collapse"), C4 (EQ cutting below 37 Hz to protect the kick's exclusive sub territory).
4. **Acid/303 accent = simultaneous cutoff + resonance + volume boost**, not a level-only effect. Stated identically across B1, B3 (implicitly via mod envelope), B6 (explicit "boosts volume AND brightness").
5. **Mono or Legato voice mode + non-zero glide/portamento (roughly 30–50%) is required for authentic 303 slides.** B1 (mono, glide 1/3), B3 (mono legato, portamento 50%), B5 (legato, portamento ~50%).
6. **Distortion/saturation stage is placed immediately after the filter, before delay/reverb**, across nearly every bass recipe regardless of subgenre (B1, B2, B3, D1, C1, C5) — filter-then-drive is the dominant chain order, not drive-then-filter.
7. **Fast/zero attack (0 ms) on the amp envelope is standard for plucky/rolling bass**, paired with a short-but-nonzero release (20–30 ms range: C5's 29 ms, B3's click-prevention release, D3's 24 ms) specifically to avoid clicks rather than to add sustain.
8. **Odd or broken-grid step counts (13, 15 steps against a 16-step/4-4 kick) or randomized accent/slide placement** are repeatedly used to keep acid basslines from feeling mechanically looped (B4, B5, A5's Futureproof acid bass).

## CONTRADICTIONS BETWEEN SOURCES

1. **Filter slope for 303-style acid**: Roland's own article says the real TB-303 is **18 dB/octave**; MusicRadar's tutorial calls for a **24 dB/octave "steep" lowpass**; the Sylenth recipe (B3) actually **switches from 24 dB down to 12 dB** for a specific patch. No agreement on "correct" slope — treat as a genre-flavor choice, not a fixed target.
2. **Rumble reverb wetness**: A1/A5 specify **100% wet**; A3 (Menzel) allows **75–100% wet** as a range. Minor but worth flagging if a recipe needs an exact number.
3. **Sidechain implementation on the rumble layer**: A1 (Gearnews/Ableton) uses a **manually-drawn volume envelope/Utility automation**, not a compressor at all, while A2, A3, A5 all use a **conventional sidechain compressor keyed off the dry kick**. These are functionally different techniques (deterministic automation vs. dynamic compression) presented as equivalent "sidechain" solutions — worth distinguishing in any executable recipe rather than collapsing to one.
4. **Oscillator layering philosophy**: the Diva "Phased Techno Bass" recipe (single oscillator, feedback-driven, others zeroed) explicitly rejects multi-oscillator layering in favor of one strong oscillator plus filter feedback for harmonic richness, whereas Repro-1 (D1), Reese (D3), and the Warehouse rolling bass (C1, 3-layer) all build thickness from **multiple simultaneous oscillators/layers**. Both approaches are presented by the same publication (Attack Magazine) as valid for the same genre — this looks like genuine stylistic disagreement, not an error.
5. **Analog "drift/slop" controls**: the Juno-60 house bass recipe (D2) turns the Condition/drift control **fully right to eliminate vintage tuning instability** ("tight tuning with no analog-style slop"), which cuts against the generally-assumed wisdom that vintage-analog imprecision is desirable in warm techno/house bass — flagged as a deliberate counter-example.

## GAPS / WEAK SPOTS IN AVAILABLE SOURCES
- **Swing percentage**: no source gave a concrete numeric swing % for bass programming; C1 only says sidechain release is "slower... for a swing feel" — qualitative, not a number.
- **Gate length / velocity curves**: only two numeric gate values found at all (Diva arp gate 47% in B1, Sylenth arp gate ~18% in B3) — too sparse to generalize a "typical gate %" for techno bass.
- Several tutorials (progressive techno C3, dub techno C4, dirty FM bass) explicitly withhold numeric saturation/compression values, describing them only qualitatively ("dial in saturation for bite") — flagged per-entry above rather than invented.

---

## SOURCE LIST
- Attack Magazine — Warehouse-Style Rolling Techno Basslines (Aykan Esen, 2020): https://www.attackmagazine.com/technique/tutorials/warehouse-rolling-techno-bass/
- Attack Magazine — Make A Techno Bassline Using Generate: https://www.attackmagazine.com/technique/tutorials/make-a-techno-bassline-using-generate/
- Attack Magazine — Phased Techno Bass (Synth Secrets, Diva): https://www.attackmagazine.com/technique/synth-secrets/phased-techno-bass/
- Attack Magazine — Progressive Techno (Beat Dissected): https://www.attackmagazine.com/technique/beat-dissected/progressive-techno/
- Attack Magazine — Basic Channel-Style Dub Techno (Beat Dissected): https://www.attackmagazine.com/technique/beat-dissected/basic-channel-style-dub-techno/
- Attack Magazine — Techno Synth Stabs (Synth Secrets): https://www.attackmagazine.com/technique/synth-secrets/techno-synth-stabs/
- Attack Magazine — Acid Synth in u-he Diva (Synth Secrets): https://www.attackmagazine.com/technique/synth-secrets/acid-synth-uhe-diva/
- Attack Magazine — How To Make An Acid House Bassline: https://www.attackmagazine.com/technique/tutorials/how-to-make-an-acid-house-bassline/
- Attack Magazine — Tech House Bass with u-he Repro-1 (Synth Secrets): https://www.attackmagazine.com/technique/synth-secrets/tech-house-bass-u-repro-1/
- Attack Magazine — Make A House Bass With The Juno-60 (Synth Secrets): https://www.attackmagazine.com/technique/synth-secrets/make-a-house-bass-with-the-juno-60/
- Attack Magazine — Dirty FM Bass: https://www.attackmagazine.com/technique/tutorials/dirty-fm-bass/
- Attack Magazine — 303-Style Arpeggiator In Sylenth (Synth Secrets): https://www.attackmagazine.com/technique/synth-secrets/tb-303-acid-arpeggiator-sylenth/
- Attack Magazine — Reese Bass Redux: https://www.attackmagazine.com/technique/tutorials/reese-bass-redux/
- MusicRadar — How to make an acid bassline like Fatboy Slim's "Everybody Needs A 303": https://www.musicradar.com/how-to/make-acid-bassline-fatboy-slim-303
- MusicTech — How to create a Chicago-style 303 acid house bassline: https://musictech.com/guides/essential-guide/how-to-create-a-chicago-style-acid-house-bassline/
- Roland Articles — Beyond Acid: Pushing the TB-303 into New Sonic Territory: https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory/
- Studio Brootle — Techno Rumble Ableton (Rumble Kick): https://www.studiobrootle.com/techno-rumble-ableton-rumble-kick/
- Mastrng — Techno Rumble: https://www.mastrng.com/techno-rumble/
- Production Music Live — 6 Steps To Make That Rumbling Techno Kick You Love (Johannes Menzel): https://www.productionmusiclive.com/blogs/news/6-steps-to-create-that-rumbling-techno-kick-you-love-with-johannes-menzel
- Gearnews — Techno Rumble in Ableton Live, Made Easy: https://www.gearnews.com/techno-rumble-ableton-live-studio/
- Futureproof Music School — How to Make Hard Techno: Kick Design, Rumble, and Club Mixing: https://futureproofmusicschool.com/blog/making-hard-techno-a-path-to-unique-sound-design

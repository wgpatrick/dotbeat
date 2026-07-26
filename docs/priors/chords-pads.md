# Chords, Stabs & Pads — Mined Sound-Design Priors

Vein: deep-house chord stabs (Kerri Chandler lineage), techno stabs, trance/melodic pads, plucks, string-machine pads.
Sources are practitioner tutorials (Attack Magazine's Synth Secrets / Passing Notes columns, Sound on Sound's Synth Secrets series, ADSR/howtomakeelectronicmusic walkthroughs, Splice blog, and specific forum threads with named practitioner handles). Where a numeric claim could not be independently re-verified from a direct fetch (only surfaced in a search snippet), this is flagged explicitly.

---

## Recipe 1 — Old-School House Chord Stab (multi-oscillator triad-in-one-patch)

**Character:** Classic house "chord stab" where the whole triad lives inside one synth patch (playable as a single key), Zebra-style wavetable synth.

**Source:** [Old-School House Chords — Attack Magazine, Synth Secrets](https://www.attackmagazine.com/technique/synth-secrets/old-school-house-chords/). Attack Magazine's Synth Secrets column, house-production specialist walkthroughs with screenshots of exact plugin parameters.

**Layer structure:** Single 3-oscillator patch = the whole chord. No separate pad/pluck/air split here — the "chord" is baked into oscillator tuning rather than MIDI note stacking.

**Oscillators:**
- OSC1: 0 semitones (root), later transposed −12 st for a bass-doubled variant
- OSC2: +3 semitones (minor 3rd), variant moved to +5 st
- OSC3: +7 semitones (5th), variant moved to +8 st
- All three at Amp 100%, wavetable position/intensity 100%; wavetable swapped to "Strontium" for a darker variant
- Unison voices: started at 2, pushed to **7** in the final variation, with pitch-cutoff/detune set to 5.00 st → 7.00 st across the variants ("subtle detuning applied for warmth")

**Filter:** Lowpass 4-pole, filter mix set fully to Filter 1. Cutoff turned down toward 0 and driven almost entirely by envelope modulation (mod envelope dial parked around the "2 o'clock" position on the amount knob).

**Envelope:** Mod envelope (1Env) targets cutoff with "a fairly swift attack and longer decay" — the classic stab shape (fast open, fast-ish close, not full sustain-off). Additional automation on the amp attack/decay to create dynamic tension across a pattern (i.e. the same patch is varied per-hit, not static).

**Effects chain (order):**
1. Reverb (FX1) — tuned for "a lush, harmonically interesting halo"
2. Dimension Expander (FX2) — stereo widening
3. Noted optional extras: subtle distortion, chorus, snapback delay, tape saturation

**Voicing:** Root-position minor triad (0/+3/+7) baked into the oscillators; bass-doubling variant drops OSC1 an octave for weight.

**Verbatim quote:** "a fairly swift attack and longer decay" (describing the stab filter-envelope shape); "subtle detuning applied for warmth."

---

## Recipe 2 — Techno Synth Stab (square + filter envelope, Hive)

**Character:** Hard-edged, short, percussive techno stab with an automated filter sweep across a phrase.

**Source:** [Techno Synth Stabs — Attack Magazine, Synth Secrets](https://www.attackmagazine.com/technique/synth-secrets/techno-synth-stabs/). Same Attack Magazine Synth Secrets column, built in u-he Hive with a full Ableton mix chain layered on top.

**Layer structure:** Single Hive patch, then treated with a full DAW effects chain (reverb → overdrive → saturator → drum buss) — i.e. the "movement" and character come from processing, not extra layers.

**Oscillators:** OSC1 = square wave. (Article doesn't specify a second oscillator; the "chord" here is a single stab tone rather than a multi-note voicing — techno stabs in this lineage are frequently monophonic/mono-note, unlike house chord stabs.)

**Filter:**
- Step 1: Lowpass, cutoff brought "right down," resonance increased "just a touch," mod-env-to-cutoff amount parked at the "3 o'clock" position
- Step 5 variant: switched to **Bandpass**, resonance cranked further for a more nasal/narrow-band stab
- Numeric "Common settings" cited elsewhere in the piece: **Lowpass 24 filter, cutoff = 52, resonance = 28, envelope amount = 92** (0–100 dial scale)

**Amp envelope (0–100 dial scale, Hive):** Attack **0**, Decay **66**, Sustain **0**, Release **29** — textbook zero-sustain stab shape.

**Filter envelope (0–100 dial scale):** Attack **5**, Decay **48**, Sustain **9**, Release **24**.
*(A second envelope-shaping pass cited in the piece: Attack 0, Decay 51, Sustain 20, Release 41 — used for a variant with more body.)*

**Effects chain (order):**
1. Hive-internal distortion — Soft Clip mode, subtle amount
2. Hive-internal delay — mix and width pushed up for a "subtle ping-pong" effect
3. Reverb (placed first in the *DAW* chain, ahead of drive) — Predelay ≈ 3ms, Decay Time ≈ 3ms (deliberately tiny — a "glue" reverb, not a space-defining one)
4. Overdrive — Dry/Wet ≈ 13%
5. Saturator — Drive 10dB, Dry/Wet rolled back low
6. Drum Buss — Drive 26% (used as a bus saturator/glue on the stab, not just drums)

**Automation/movement:** Filter cutoff swept across the second section of the phrase; mod-env attack/decay nudged on the final note of a phrase; reverb dry/wet automated up specifically on the last note to open the tail.

**Verbatim/paraphrase of technique:** Resonance described as producing "the telltale squelchy sound" via feedback at the cutoff point.

---

## Recipe 3 — Detuned Pad (5+7 voice dual-oscillator wavetable pad)

**Character:** Slow-blooming, wide, warm analog-style pad with built-in sidechain-style pumping.

**Source:** [Detuned Pad — Attack Magazine, Synth Secrets](https://www.attackmagazine.com/technique/synth-secrets/detuned-pad/). Attack Magazine Synth Secrets, wavetable-synth walkthrough (Zebra2-class engine — envelope/LFO naming conventions match u-he Zebra2).

**Layer structure:** Two-oscillator patch (A1 sine-based, A2 saw-based) with unison stacking inside each — no separate pluck/air layer; width comes entirely from unison + unison detune + chorus.

**Oscillators:**
- **A1**: 5 unison voices, **sine** wave, pitched down 1 octave, detune **4.05 cents**, phase offset 300°
- **A2**: 7 unison voices, **sawtooth** wave, detune **3 cents**, phase offset 100°, phase inverted
- Total polyphony across both oscillators: 10 voices

**Filter:** Lowpass. Cutoff at dial position "7" (≈800Hz estimated), resonance "3", drive "7". A parallel "Warm Drive" stage engaged with its own cutoff around 60Hz and keytrack 3 (a low-end warmth/saturation stage separate from the main filter).

**Amp envelope:** Attack **3 seconds**, Release **7 seconds** — an extremely slow pad envelope (contrast directly against the 0ms techno-stab attack in Recipe 2).

**Movement (LFO):** LFO1 targets oscillator A phase, amount ≈3.52, rate at the "10–11 o'clock" position, gain maxed — continuous slow phase drift is the primary movement source (rather than filter-cutoff LFO).

**Effects chain (order):**
1. **Chorus** — Delay 16ms, Rate 0.22Hz, Depth 50%, Feedback 12%, Width 50%, Dry/Wet 60%
2. **Distortion (Overdrive)** — Amount 0.3, Dry/Wet 20%
3. **EQ** — Bass +9dB @ 570Hz, Treble +3.5dB @ 440Hz, 1-pole slopes (a fairly aggressive low-mid boost for a pad — notably not a scoop)
4. **Reverb** — Size 6.0, Predelay 0ms, Width 80%, Damp 7.0, Dry/Wet 30%

**Extra movement trick:** A second LFO used as a sidechain-pump simulator — targets Volume A, tempo-synced to 1/4, gain 10, offset 7, amount −10 — i.e. the pad ducks itself rhythmically without an actual sidechain compressor.

**Measurable target:** None stated numerically beyond the parameters themselves.

---

## Recipe 4 — Deep House Chord Stab (Sytrus/FM, FL Studio)

**Character:** FM-based deep-house Maj7 stab with ping-pong delay and warm, low-cut reverb.

**Source:** [How To Create Deep House Chord Stab With Sytrus](https://howtomakeelectronicmusic.com/how-to-create-deep-house-chord-stab-with-sytrus/) — HowToMakeElectronicMusic.com FL Studio/Sytrus walkthrough.

**Layer structure:** Single 4-operator FM patch encoding the whole Maj7 chord (like Recipe 1, the chord is built into the oscillator/operator ratios, not into MIDI voicing).

**Oscillators (FM operator ratios, master pitch −24 st):**
- OP1 (root): ratio 2.0000
- OP2 (3rd, +4 st): ratio 2.5198
- OP3 (5th, +7 st): ratio 2.9966
- OP4 (7th, +11 st): ratio 3.7754
- All operators: square wave

**Filter:** Vanilla Low Pass. Cutoff decreased from max (no Hz given), resonance increased "for bite." Filter envelope: attack shortened, release tuned for a "stabby" character.

**Amp envelope:** "Semi-short release" applied across all operators (no ms given — flagged as imprecise in the source itself).

**Effects chain (order):**
1. Delay — Ping-Pong mode, time 5:00 (tempo-sync notation), stereo offset ≈12ms
2. Reverb — Color "Warmer," Low Cut ≈750–800Hz, Decay ≈5 seconds, High Damping bypassed

**Performance detail:** Portamento enabled (glide 0:06–0:07), monophonic mode enabled — i.e. this "chord" patch is played as a mono lead/stab voice with slides between chord roots, not polyphonically.

**Verbatim characterization:** achieves its "stabby" aesthetic through "percussive envelope shaping combined with ping-pong delay and warm reverb processing."

---

## Recipe 5 — Deep House Minor-Chord Stab (practitioner forum consensus recipe)

**Character:** The generic, widely-cited "deep house stab" recipe — repeated almost verbatim across multiple tutorials, so treated here as a distilled consensus recipe rather than one source.

**Source:** [KVR Audio Sound Design Forum — "How to make this deep house stabs"](https://www.kvraudio.com/forum/viewtopic.php?t=327685), practitioner handle "MOK19," corroborated by the Sytrus tutorial (Recipe 4) and the Attack "Old-School House Chords" article (Recipe 1).

**Oscillators:** 3 saw or triangle oscillators, tuned to root/+3/+7 semitones for a minor triad (root/min3rd/5th). Example voicing cited: D3, F3, A4. A more advanced variant given: **Gm9 voiced A–Bb–D–F bottom to top** — deliberately including the dissonant minor-2nd (A–Bb) interval, i.e. a tension-note stab rather than a plain triad.

**Filter:** Lowpass. **Cutoff set medium-low, ~250–350Hz.** Resonance: "experiment" (no fixed number given, but a small amount implied).

**Filter envelope:** Medium magnitude, **sustain = 0, decay short** — this decay length is explicitly called out as "primarily what makes a patch a stab."

**Amp envelope:** General guidance only ("may add pluckiness, punchiness, or release") — no numbers; this is the piece's own caveat, not a gap in extraction.

**Voicing philosophy quote:** "You'll have to experiment to find the timings that you prefer" (filter envelope decay) — i.e. this recipe explicitly treats decay time as the primary tunable "stabbiness" knob, more important than the exact cutoff.

**Cross-check:** Chord selection (minor triad, or 9th-chord tension voicings) is called out as more decisive for the "deep house" identity than any synthesis parameter — a recurring theme across this whole vein.

---

## Recipe 6 — Analogue Pad with VoxDoubler widening (Ableton Analog)

**Character:** Warm two-oscillator analog pad with vibrato that speeds up as the filter opens, widened via a doubling plugin rather than chorus.

**Source:** [Trippy Leads & Analogue Pads — Attack Magazine, Synth Secrets](https://www.attackmagazine.com/technique/synth-secrets/trippy-leads-analogue-pads-ableton-analog-sonnox-voxdoubler/), built in Ableton's Analog instrument plus Sonnox/Waves VoxDoubler.

**Oscillators:** Both **sawtooth**, both tuned down one octave. Detuned **in opposite directions** from each other (no cents value given). A "bit of noise" layered in underneath.

**Filter:** Lowpass, small amount of resonance ("nice frequency peaks"). Filter envelope amount turned up; attack backed off, decay pushed up, sustain brought down (shape only, no ms given).

**Movement:**
- Vibrato added, with **rate automated to speed up as the filter envelope opens and slow down as it closes** — a distinctive cross-modulation of two movement sources rather than a static LFO
- Small pitch-envelope amount added for "a nice slide at the start of the note"
- Unison detune added on top for thickness

**Effects chain (order):**
1. EQ — low frequencies and low-mids swept away (high-pass/scoop, no freq given)
2. VoxDoubler in "Widen" mode — Mix and Width pushed high, Pitch and Timing increased to separate the doubled voice from the source, Depth kept moderate "for focus," Tone control pushed up
3. Reverb send — described purely as "to increase sense of space"

**Verbatim technique note:** vibrato rate deliberately tied to the filter envelope's open/close motion — an explicit alternative to a plain fixed-rate chorus/vibrato LFO for creating pad movement.

---

## Recipe 7 — Analogue String Pad (PWM + detuned second oscillator)

**Character:** Classic string-machine-style pad built from a PWM square wave plus a detuned sawtooth an octave up.

**Source:** [Analogue String Synthesis — Attack Magazine, Tutorials](https://www.attackmagazine.com/technique/tutorials/analogue-style-string-synthesis/).

**Oscillators:**
- OSC1: Square/pulse wave with pulse-width modulation
- OSC2: Sawtooth, one octave higher than OSC1, detuned slightly sharp via the synth's "Fine" tune control, mixed in "slightly quieter than the main oscillator"

**Modulation:** LFO2 (sine) drives OSC1's pulse shape for PWM. PWM speed explicitly "shouldn't be too fast"; depth "moderate" — i.e. slow, subtle PWM rather than the fast robotic PWM used on leads.

**Filter:** Lowpass, small amount of resonance.

**Envelope:** Amp envelope given "extended attack and release times" (pad-appropriate, no ms specified); filter envelope given "small amount" of timbral variation over the note's duration (subtle, not a stab-style sweep).

**Design philosophy quote:** "square (or pulse) wave...provides a rich timbral starting point made up of odd harmonics" — i.e. the choice of square-over-saw as the base oscillator is explicitly because odd-harmonic content reads as more "string/reed-like" than a saw's full harmonic series.

---

## Recipe 8 — PWM String Pad, dual hardware-synth patch (Korg T2 / Roland Super JX-10)

**Character:** Two named, fully-specified factory-style vintage patches for lush PWM string pads — the most parameter-complete pad recipe found in this vein.

**Source:** [Synthesizing Strings: PWM & String Sounds — Sound on Sound, Synth Secrets series](https://www.soundonsound.com/techniques/synthesizing-strings-pwm-string-sounds).

**Patch A — Korg T2:**
- Both oscillators: **sawtooth**, 16' octave, detune 0 at baseline (variant note: detuning OSC2 by "10 or thereabouts" improves richness)
- Modulation: square-wave pitch modulation at **60Hz**, intensity **02**, targeting OSC2 (this is audio-rate FM-style modulation for PWM-like buzz, not a slow LFO)
- Filter: cutoff **75** (both filters), minimal keyboard tracking
- Amp envelope: **Attack 10, Sustain 99, Release 49**, keyboard tracking **−04** (weights the envelope warmer/slower in the low register)

**Patch B — Roland Super JX-10:**
- DCO1: 8', sawtooth, LFO depth **02**
- DCO2: 8', sawtooth, fine tune **−4 cents**, LFO depth **00**
- LFO: square wave, rate **78**
- Filter (VCF): frequency **47**, envelope amount **14**, key-follow **64**
- Envelope 1: **Attack 15, Decay 00, Sustain 99, Release 39**

**Effects (both patches):** "Careful use of EQ allows you to shape the sound, and the addition of chorus and a splash of reverb" is cited as the standard finishing chain for convincing vintage ensemble character on modern instruments.

---

## Recipe 9 — String Machine Ensemble Pad (analog VCO + S&H random pitch)

**Character:** Non-velocity-sensitive, slow-swell ensemble pad using random (not periodic) pitch drift instead of vibrato.

**Source:** [Synthesizing Strings: String Machines — Sound on Sound, Synth Secrets series](https://www.soundonsound.com/techniques/synthesizing-strings-string-machines).

**Oscillators:** Primarily sawtooth, with PWM pulse waves mixed in for extra richness. VCO1 at 8'; VCO2 optionally dropped an octave for weight. Detune between VCO1/VCO2 kept **minimal** — the article explicitly warns more detune here causes a "weird 'off colour' timbre" (contrast with Recipe 3's Zebra pad, which pushes 3–4 cents deliberately).

**Modulation:**
- LFO1: triangle wave, moderate rate, vibrato on VCO1
- LFO2: **sample & hold fed from a noise source**, applied to VCO1 pitch, explicitly to get "no periodic modulation" — random, non-repeating drift rather than a regular vibrato wobble
- PWM rate (when used on both oscillators): triangle wave, "slightly increased" rate

**Filter:** Lowpass, roughly half-closed, moderate key-follow, no filter modulation (a static filter — all the movement is in pitch, not tone).

**Envelope:** VCA envelope has a **trapezoid contour** producing a crescendo with an extended tail; attack/release can be pushed further for "slow, dreamy pads." No velocity sensitivity, matching the original hardware's architecture.

**Character quote:** "thick, it's lush, and it's certainly an ensemble sound."

---

## Recipe 10 — Synthwave Pad (Massive, PWM detuned pair + S&H sparkle layer)

**Character:** Retro synthwave pad — deliberately narrow-panned/near-mono for period-correct vintage character, with an added noise/S&H layer for top-end sparkle.

**Source:** [Create a retro Synthwave pad in 6 steps — Splice Blog](https://splice.com/blog/creating-a-retro-synthwave-pad-within-massive/), built in NI Massive.

**Oscillators:** OSC1 & OSC2 both a pulse-saw PWM wavetable. OSC1 pitch detune **+0.10**, OSC2 pitch detune **−6.90** (a wide, deliberately asymmetric spread — not a small ±few-cents detune). Unisono: **4 voices**. Pitch-cutoff 0.10. Pan pulled toward mono (not fully wide) for vintage character.

**Filter:** "Daft" filter type (a nonlinear/analog-modeled filter mode, chosen "for thicker analog presence"), cutoff ≈"1 o'clock," resonance ≈"9 o'clock" (moderate cutoff, low resonance).

**Amp envelope:** Attack ≈"9 o'clock," Release ≈"12 o'clock" (decay/sustain unspecified) — moderate, not instant, attack.

**Effects chain (order):**
1. Flanger (positive mode) — slower rate, minimal feedback
2. Reverb — Density maxed, Color bright
3. Insert — Sample & Hold on a separate layer, pitch ≈"2 o'clock," dry/wet tuned in for "sparkly top end"

**Extra movement:** A dedicated LFO modulates Pan (amount 4), tempo-synced to 3/16, crossfade curve biased toward sine — panning motion as a distinct movement source layered on top of the PWM drift.

**Verbatim quote:** "S&H gives the pad a more sparkly top end" (vs. a plain noise oscillator) — the practitioner's stated reason for choosing sample-and-hold modulation over static noise for the air/sparkle layer.

---

## Recipe 11 — Trance Supersaw Pad/Lead (unison-stacked saws)

**Character:** The "wall of saws" trance pad/lead sound — the single most consensus-heavy recipe found, repeated near-identically across multiple sources.

**Source:** Cross-referenced from VI-Control ["Tutorial - Supersaw Trance Lead"](https://vi-control.net/community/threads/tutorial-supersaw-trance-lead.84188/), Syntorial's ["Giant Face-Melting Supersaw Trance Lead"](https://www.syntorial.com/tutorials/synth-quickie-supersaw-trance-lead/), and KVR forum pad-design threads.

**Oscillators:**
- 3–4 saw-wave oscillators, each running its own unison stack (rather than one giant unison stack on a single oscillator)
- One configuration: **12-voice unison** on one oscillator + **6-voice unison** on a second, both detuned, both saw
- Another cited approach: 9-voice unison per oscillator, oscillators additionally detuned from each other (one pitched down, one up) to create an effective ~27-voice spread
- **Detune amount: ~7.5 cents per oscillator** cited as the practical sweet spot — "turned up to where it just starts to sound slightly out of tune," enough for aggression but "not so much that it sounds swirling"

**Amp envelope:** Pad variant uses a **full 1-second attack** — explicitly called out as what gives the supersaw pad its "characteristic slow bloom" (contrast: the lead variant of the same patch uses a fast/instant attack).

**Design-mistake warning (counterintuitive/contrarian note):** "Stack two or three saw-based layers with different unison counts rather than one giant supersaw" — i.e. multiple modestly-stacked oscillators beat one maximally-stacked oscillator. Also: "past a certain point, unison adds phase-cancelled noise where clarity is needed" — explicit warning against over-stacking.

**Voicing/tuning approach:** Sources explicitly favor tuning unison/detune **by ear** rather than fixed numeric recipes, "focusing on creating harmonic richness and movement without sacrificing clarity" — flagged here as a rare case where practitioners explicitly reject a fixed numeric target.

---

## Recipe 12 — Kerri Chandler Chord Voicing & Arrangement (the "deep-house chord" tradition itself)

**Character:** Not a synthesis patch but the defining *harmonic/arrangement* recipe for the deep-house chord-stab tradition — included because the brief calls this out as a named, well-documented lineage, and because voicing is treated as more decisive than synthesis parameters across this whole vein (see Recipe 5's cross-check).

**Source:** [Kerri Chandler Chords: The Ultimate Guide](https://www.attackmagazine.com/technique/passing-notes/kerri-chandler-chords/) and [Part 2](https://www.attackmagazine.com/technique/passing-notes/kerri-chandler-chords-part2/) — Attack Magazine's Passing Notes column (music-theory-for-producers), Ableton-session-based analysis of specific Kerri Chandler productions.

**Voicing rules identified:**
- Signature voicing: **3rd-inversion 7th chords** — the 7th sits at the bottom of the voicing, followed upward by root, 3rd, 5th (example given: G minor voiced with F–G#–D from the bottom, i.e. m7–root–5th ordering)
- **Root notes routinely omitted from the chord-stab part entirely** — works "because the bass line has the roots covered." This is the load-bearing trick that lets a chord stab sit in a dense low-mid mix without clashing with the bass.
- Rhythm: pattern deliberately **leaves out beats occupied by the main drum hits**, emphasizing syncopated off-beat 16th-notes instead — the chord part is built around the drum pattern's gaps, not laid on top of it
- Voicing variation trick: **playing different voicings of the same chord back-to-back** for textural movement across a loop, rather than repeating one static voicing
- Parallel motion (whole-chord shifts up/down together) called out as "very common in house music" and easy to execute via a chord-trigger MIDI effect
- "Mommy What's a Record"-style pedal-bass arrangement: a static/looping sub-bass note underneath a 3-chord progression, with a syncopated stab specifically on the notes C and G
- "Checkmate"-style processing: simple triad / first-inversion triad, with **a 1/8-note delay with short feedback** applied specifically to the electric-piano chord part
- "Rain"-style advanced voicing: tension-heavy voicings stacking 7ths, 9ths, 13ths and even #11ths — i.e. the deep-house chord tradition explicitly extends to dense extended/tension chords, not just plain triads
- Chromatic passing chords achieved via "borrowed chords" (modal interchange) between the main changes

**Compression detail (lower-confidence — surfaced in a search summary of this series, not independently re-confirmed on direct fetch of either article body):** "4–5dB of compression with a slow attack and fast release" applied to the chord stabs, explicitly to let the transient through the slow attack and then use the fast release to create a pumping effect described as working well for rhythmic chords.

**Verbatim quotes:** "third inversion seventh chords" where "the seventh note is at the bottom, followed by the root, third and fifth notes"; "omitting the root notes from the stabs, which is not an issue because the bass line has the roots covered"; "most voicings contain many tension notes, including sevenths, ninths, 13ths and even #11ths."

---

## Recipe 13 — Layered Chord Stab (piano + EP layering, sub-bass chorus)

**Character:** A modern (sample/preset-layering, not synthesis-from-scratch) take on the deep-house chord stab, built by stacking two acoustic/electric-piano-style instrument layers rather than programming oscillators.

**Source:** [Levelling Up Your Chord Stabs — Attack Magazine, Passing Notes](https://www.attackmagazine.com/technique/passing-notes/levelling-up-your-chord-stabs/).

**Layer structure:**
- Keys layer: **Spitfire Originals "Firewood Piano"** layered with **Spitfire Labs Electric Piano: Chorus preset** — an acoustic-piano transient/body layer under an EP-with-chorus layer for stereo width and shimmer
- Bass layer: a separate sub-bass sample, widened with chorus
- Tempo/context: 120 BPM, four-to-the-floor beat

**Voicing guidance (extends Recipe 12's rules):**
- Root-position Minor 7 voicings as the base
- 3rd-inversion voicing pattern (explicitly credited as "used frequently by Kerri Chandler")
- Adding the 4th scale-degree (11th) on top for cluster/tension texture
- Adding the 2nd scale-degree (9th) at varying octaves for additional color
- Explicit rule restated: **"keys are not playing the root note"** — the bass instrument alone carries harmonic root duty

**Gaps (flagged, not filled with invented numbers):** no filter cutoff/resonance, envelope ms, reverb size/predelay, delay time/feedback, or compression/EQ values given anywhere in this article — it is a layering-and-voicing recipe, not a synthesis recipe.

---

## Recipe 14 — Choir Pad/Stab/Bass Layer Stack (Forest Swords / Kelly Lee Owens style)

**Character:** A three-layer vocal-choir chord architecture that is the most explicit, fully-specified **pad + stab + bass/air** layer split found in this whole vein — added after a coordinator request for concrete layer architectures.

**Source:** [Creating Choirs In The Style Of Forest Swords Or Kelly Lee Owens — Attack Magazine, Passing Notes](https://www.attackmagazine.com/technique/passing-notes/creating-choirs-in-the-style-of-forest-swords-or-kelly-lee-owens/), built entirely from Spitfire Audio's Epic Choir library.

**Layer structure — three layers, one instrument, three roles:**

1. **BASS layer** ("anchor the track's groove," locked to the kick): Epic Choir "Tenors & Basses: Long Mmm" preset, duplicated into two pitched chains — primary at **−12 semitones**, a sub-reinforcement duplicate at **−24 semitones**. Mixer blend on the primary chain: Close mic 100%, Tree mic 46%, Ethereal mic 12%, Reverb 8%, Release 12%, Tightness maxed (i.e. the "wet"/space mics are turned almost all the way down on the bass layer — it's kept dry and tight). Volume made up +400% to compensate for the pitch-down. Processing: mono Utility, then a compressor at **Threshold −53.1dB, Ratio 10:1, Attack 30ms, Release 20ms, Makeup +14dB** — an aggressive, fairly fast-attack squash to keep the pitched-down choir tight and punchy rather than boomy.
2. **PAD layer** (harmonic bed, "frequency spectrum coverage"): same "Tenors & Basses: Long Mmm" preset, un-pitched, but with the *opposite* mixer balance from the bass layer — Close mic 63%, Tree 26%, **Ethereal 100%**, Reverb 10%, Release 50%, Tightness 50% (the pad layer is deliberately the "wet"/diffuse mic blend, mirroring the bass layer's dry blend). Chord voicing: inverted 7th chords with the root doubled an octave below, moving through Dm–Dm–F–F–Dm–Dm–Am–F over 8 bars. Expression (a CC swell) automated from ~50% up to maximum into each new chord — the pad literally swells up in volume/brightness on every chord change rather than sitting static.
3. **STAB layer** (rhythmic "punch," frequency penetration): a *different* preset — "Sopranos & Altos: Short Staccato Syllables" — layered as two instances, the second detuned **just under half a semitone** down from the first (a small, deliberately dissonant detune for width/grit, not a clean unison). Processing: Overdrive with its filter set at **8.17kHz**, Width **1.21**, Dry/Wet **17%**, then a compressor using Spitfire's "Sustained Lead Vocal" preset with Threshold **−40dB**. MIDI: monophonic staccato pattern with velocity variation (not a static static-velocity stab).

**Balance logic worth extracting as a rule:** the bass and pad layers use the *same* preset/instrument but with **inverted mic-mix ratios** (bass = dry/close-mic-heavy, pad = wet/ambient-mic-heavy) — i.e. one preset is split into two functionally distinct layers purely via internal mix-bus balance, rather than needing two different patches. The stab layer alone gets its own distinct (staccato) source patch and its own overdrive/compression chain, because its job (transient/punch) is different in kind from sustain (bass/pad), not just different in level.

---

## Recipe 15 — Ensemble/Massive Chord Voicing Across Multiple Synth Layers

**Character:** A "massive chords" arranging technique — the same chord voiced across up to 7 different instrument layers split by frequency register, each layer given different notes rather than duplicating the full chord on every layer.

**Source:** [Massive Chords With Chord Voicings Across Synths and Ensemble Strings — Attack Magazine, Passing Notes](https://www.attackmagazine.com/technique/passing-notes/massive-chords-with-ensemble-voicings/).

**Layer/register structure (7 instruments across 3 registers):**
- **Bass register (2 instruments):** sub-bass synth + cello, both playing the **lowest two notes of the chord in octaves** (i.e. this register doubles rather than splits)
- **Mid register (2 instruments):** piano + a flute-like synth, splitting the **3rd and 4th notes of the chord** between them (one instrument per note, not both playing the full triad)
- **Upper register (3 instruments):** strings + two pad synths, taking the **highest notes**, deliberately **reordered** across the three so each instrument's own melodic line differs from the others

**Explicit rule:** "It's good practice to change things around and not keep the notes in the exact same order so that the individual melodies tell their own different stories" — i.e. avoid parallel doubling in the upper register; give each layer a distinct voice-leading path even though they're all playing notes of the same chord.

**Definition given for the technique:** "An ensemble chord is when different instruments play different notes that when combined make a chord. The effect is one bigger sounding, *massive*, voicing with various textures" — this is presented as a distinct technique from single-patch multi-oscillator chord stabs (Recipes 1/4) precisely because the "massiveness" comes from timbral variety per note, not from one instrument's stacked unison.

**Practical gotcha called out:** synth/preset default octave settings often shift a preset's actual sounding pitch away from what's shown on the piano roll — the article flags manually re-checking and correcting octave placement per preset so the intended register split (bass/mid/upper) is actually achieved.

**Stereo treatment:** panning applied to the mid-range and upper-octave instruments specifically (not the bass layer) to widen the chord, "mimicking orchestral positioning."

---

## Recipe 16 — Zebra 3 Pluck (TZFM pluck with hard numeric filter-envelope decay)

**Character:** A percussive, FM-based "pluck" patch — the most precise millisecond-level attack/decay/release numbers found for a pluck/stab-adjacent sound in this research pass.

**Source:** [Inventing Your Own Patch From Scratch With Zebra 3 — Attack Magazine, Synth Secrets](https://www.attackmagazine.com/technique/synth-secrets/inventing-your-own-patch-from-scratch-with-zebra-3/).

**Oscillator/FM setup:** TZFM (through-zero FM), FM Mod amount 8, carrier:modulator ratio **1.0 : 2.5**, feedback 73. A slow LFO (2-bar time base, single-trigger, mod depth 48) rides on top for slow evolving character across a held/looped phrase.

**Filter:** Low Pass 24dB "Old Time" mode. Cutoff parked low (≈8.18Hz raw dial position — effectively fully closed at rest, opened entirely by envelope).

**Filter envelope (Envelope 1 — the one actually shaping the "pluck"):**
- **Attack: 0ms**
- **Decay: 1.25 seconds (1250ms)**
- **Sustain: 31** (not zero — some body remains, distinguishing this "pluck" from a harder zero-sustain stab)
- **Release: 96.1ms**
- **Mod depth: 105** (drives filter cutoff hard on the initial transient)

**Secondary envelope (Envelope 3 — drives an overdrive/drive stage, velocity-sensitive):**
- Attack ≈ **40ms**, Decay at maximum, Velocity sensitivity maxed — the overdrive stage's own bite is timed *slower* than the main filter-envelope attack (0ms), so the harmonic "grit" blooms in just behind the initial transient rather than being present instantly.

**Effects:** Built-in reverb used purely as a send-bus (wet amount not specified).

**Character quote:** described as producing a "plucked vibe" via "percussive attack and resonant harmonic content, progressing from initial filtered tone opening through envelope control into overdrive that responds to MIDI velocity."

**Why this matters for the attack/decay-in-ms question specifically:** this is the one recipe in this pass giving genuine millisecond values for a pluck-type envelope end to end — **0ms attack, 1250ms decay, 96.1ms release** on the filter envelope, plus a **~40ms** attack on a secondary (drive) envelope. Contrast this against Recipe 14's compressor attack of **30ms** on a *sustained bass* layer — that 30ms number is a compressor timing constant applied to tame a pitched-down sustained pad/bass, not a synth amp-envelope attack on a stab/pluck itself. No source in this research pass gives a stab/pluck **amp-envelope** attack time as a nonzero millisecond figure in the 10–30ms range — every stab/pluck amp-envelope attack found (Recipes 2, 5, 16) is effectively **0ms**, with all of the "shape" and perceived punch/transient character instead controlled by decay/release length (tens of ms to ~1.25s) and by separate downstream compressor attack settings (which do land in the 20–30ms range, per Recipe 14's bass-layer compressor: Attack 30ms/Release 20ms). This is worth flagging directly to any build stream benchmarking against a "12ms" figure: none of the sources mined here use 12ms anywhere, and the closest analogous real number (30ms) belongs to a **compressor**, not an **oscillator/filter amp envelope**.

---

## Additional Voicing Rules — Chords vs. Bass (Attack Magazine "Passing Notes" cluster)

Gathered from a second pass over Attack Magazine's Passing Notes chord-theory index, specifically targeting rules for keeping chord parts out of the bass's way:

- **Inversions for frequency spacing** ([Lessons From Disco](https://www.attackmagazine.com/technique/passing-notes/lessons-from-disco-chords/)): voicing a chord in an inversion (e.g. a C major triad voiced E–G–C low-to-high instead of root-position C–E–G) **compresses the chord into a smaller overall frequency range**, which "gives other instrumental parts more room in the mix" — presented as the direct mechanism (not just a harmonic-color choice) for avoiding bass/chord clash. Verbatim: "voicing the chords to sit in a smaller frequency range also gives other instrumental parts more room in the mix."
- **Voice leading as a mix-avoidance tool, not just a theory nicety:** the same article ties inversion choice to voice leading — keeping the top note of each chord close to the top note of the previous chord (rather than large jumps) — because "the human ear tends to hear the highest notes in a chord progression as a form of melody," so smooth voice leading keeps the ear anchored on the chord's top line and away from competing with other register-adjacent parts.
- **Octave displacement to tighten a chord** ([Deep House Chords — Passing Notes](https://www.attackmagazine.com/technique/passing-notes/passing-notes-deep-house-chords/)): dropping a single chord tone (specifically the 7th, in the given Am7 example) down an octave "keeps the notes closer together" — an explicit octave-displacement move used to compress a spread 7th-chord voicing into a tighter cluster that leaves more low-frequency headroom.
- **Omit non-essential tones, keep the color tone:** the MAW-style example in the same article deletes chord tones for a "cleaner" voicing while explicitly preserving the 7th specifically, because the 7th is what signals "deep house" harmonic identity — i.e. when thinning a voicing to avoid mud, the note that defines the genre-specific chord color is the last one to cut, not the first.
- **9th vs. add2, defined by register, not just theory** ([Further Chords](https://www.attackmagazine.com/technique/passing-notes/further-deep-house-techno-chords/)): a 2nd-scale-degree tone only "becomes" a 9th (an upper-structure tension) once it's voiced *above* the octave; voiced within the octave it reads as an add2/close-cluster tone. This is a register rule with direct mixing consequences — the same pitch class can either sit inside the congested low-mid area (as an add2) or up in the tension-note register (as a 9th) purely based on which octave it's placed in.
- **Chord-pad low/high octave doubling** ([The Theory Of Techno Pads, Part 1](https://www.attackmagazine.com/technique/tutorials/the-theory-of-techno-pads-part-1/)): pads built from triads (root + 2 scale-steps + 4 scale-steps, i.e. a plain triad) with optional low- and high-octave doublings layered in for fullness; the same article's one hard synthesis number is a **filter-cutoff automation starting at 50Hz** and rising slowly to a high value across every 4-bar phrase — a very low, sub-audible-feeling starting cutoff specifically chosen so the pad "blooms" into audibility rather than starting already bright.
- **Cinematic pad layering (register + time-gated third layer):** [Cinematic String-Synth Hybrid Chords With Spitfire Audio Polaris](https://www.attackmagazine.com/technique/passing-notes/cinematic-string-synth-hybrid-chords-with-spitfire-audio-polaris/) stacks three preset layers (a foundation "Aether" pad, a mid-texture "Aether" pad, and a third "Overdrive Pad" layer gated to only bars 13–18 — i.e. a layer that is time-limited/arrangement-gated rather than always-on) plus a filter-driven tremolo (filter parameter ≈30% to introduce volume-modulating tremolo) and an Expression CC swelling from ~50% to max every 2 bars — the same swell-into-every-chord-change automation pattern seen independently in Recipe 14's pad layer.

---

# Cross-Source Consensus

1. **Stab envelope shape is universal:** every stab recipe (Recipes 1, 2, 4, 5) uses fast/zero attack, a genuinely short decay, and near-zero sustain on the filter envelope — and multiple sources independently state that **decay time, not cutoff frequency, is the primary control for "how stabby" a patch feels** (Recipe 5's explicit framing; matches Recipe 1's "swift attack and longer decay" and Recipe 2's Decay 66/Sustain 0 amp envelope).
2. **Pad attack times are 1–3+ orders of magnitude longer than stab attacks**, and several sources tie the pad attack explicitly to character: Recipe 3's 3-second amp attack, Recipe 11's 1-second "slow bloom" attack, Recipe 9's "trapezoid... crescendo" — vs. Recipe 2's 0ms stab attack. This attack/decay contrast is the single clearest, most load-bearing numeric distinction in the whole vein.
3. **Root-omission is a named, repeated rule, not a one-off trick:** Recipe 12 (Kerri Chandler analysis) and Recipe 13 (layered stab) both state the keys/chord part deliberately omits the root and leaves it to the bass — this is presented as *the* mechanism by which dense chord stabs avoid clashing with the bass in deep house.
4. **Chorus + reverb (in that order) is the default pad finishing chain** across Recipes 1, 3, 8, 9, 10 — chorus/ensemble first for width and beating, reverb after for space. Recipe 3 is the only one giving hard numbers (chorus 16ms/0.22Hz/50% depth/60% mix, then reverb size 6.0/0dB predelay/30% mix).
5. **Dual-oscillator pad construction with deliberate opposite-direction detune is close to universal**: Recipe 6 (opposite-direction detune, no cents given), Recipe 3 (+4.05¢ / +3¢ opposing phase), Recipe 10 (+0.10 / −6.90, wide asymmetric), Recipe 7/9 (saw + PWM-square pair). The specific cents vary by an order of magnitude, but the "two detuned/opposed oscillators minimum" structure recurs everywhere.
6. **A saw+square (or saw+PWM) oscillator pairing recurs for string/analog pads specifically** (Recipes 7, 8, 9) — odd-harmonic square/pulse content is explicitly chosen for its "string/reed-like" quality, paired with a saw for fullness.
7. **Chord voicing is repeatedly treated as more decisive than synthesis parameters** for nailing the "deep house" identity specifically (explicit in Recipe 5's cross-check and central to Recipes 12/13) — a notable meta-consensus: several practitioner sources say get the chord/voicing right first, then any reasonable subtractive patch will read as "deep house."
8. **Stab/pluck amp-envelope attack is consensus-zero, not "short-but-nonzero":** every stab or pluck patch across this whole pass that specifies an amp- or filter-envelope attack numerically gives **0ms** (Recipe 2's Hive stab, Recipe 4's Sytrus stab implicitly via "shortened attack," Recipe 16's Zebra 3 pluck filter envelope). Punch/character is instead entirely a function of **decay and release length**, which vary widely by design intent: tens of ms for a hard techno stab (Recipe 2: Decay 66/Release 29 on a 0–100 dial; Recipe 16: Release 96.1ms) up to a full **1.25 seconds** of decay for a "pluck" that's meant to have more sustained body (Recipe 16). Nothing in this pass supports a nonzero attack in the 10–30ms range for a stab/pluck oscillator envelope specifically — the only real ~30ms figure found anywhere in the corpus is a **compressor** attack time (Recipe 14, bass layer: Attack 30ms/Release 20ms), applied downstream of the synth to tame a sustained (not stabbed) layer.
9. **Layer architecture converges on splitting one job per layer, not stacking the same job three times:** Recipe 14 (choir pad/stab/bass), Recipe 13 (piano+EP keys / sub-bass), and Recipe 15 (7-instrument ensemble chord) all assign each layer a distinct *function* (sustain/harmony vs. transient/punch vs. low-end anchor) rather than three layers all playing the same role for loudness. Recipe 14 makes this most explicit: the bass and pad layers reuse the identical source instrument but achieve their different roles purely by inverting the internal (dry-mic vs. wet-mic) balance, while the stab layer alone gets a structurally different source patch and processing chain because a transient role can't be reached by remixing a sustain-oriented patch.

# Contradictions

1. **Detune philosophy: subtle vs. deliberately aggressive.** Deep-house/ambient pad sources (Recipe 3: 3–4 cents; Recipe 9: explicitly warns wider detune causes "weird 'off colour' timbre") treat detune as a subtle warming agent to be used sparingly. Trance/lead sources (Recipe 11) push detune to ~7.5 cents per oscillator across many unison voices specifically **for aggression**, and Recipe 10's synthwave pad uses a wildly asymmetric −6.90¢/+0.10¢ split. There is no single "correct" detune magnitude in this vein — it's genre-and-role dependent, and at least one source (Recipe 9) explicitly frames more detune as a *defect* that others (Recipe 11) explicitly chase as a *feature*.
2. **Unison stacking: "more is better" vs. explicit anti-pattern warning.** Within the same trance-lead source cluster (Recipe 11), one practitioner recommends maxing unison to build "an effective 27-voice unison," while another explicitly warns "past a certain point, unison adds phase-cancelled noise where clarity is needed" and recommends 2–3 modestly-stacked layers instead of one maximal stack. Both claims come from the same search cluster of trance-pad tutorials — the contradiction is presented as an open debate within the practitioner community itself, not resolved.
3. **How the "chord" gets built at all.** Recipes 1 and 4 bake the chord into a single patch via fixed oscillator/operator semitone offsets (0/+3/+7, or FM ratios for a Maj7) — meaning the "chord" plays from one key and cannot be reharmonized without reprogramming the patch. Recipes 12 and 13 instead build the chord entirely through MIDI voicing (multiple notes played into a normal, single-note-per-oscillator patch). These are two structurally incompatible workflows for the same sonic goal (a "chord stab"), and none of the sources reconcile which is preferable — the multi-oscillator-in-one-patch approach trades reharmonization flexibility for guaranteed voicing consistency and playability from a single key/pad trigger.
4. **Filter type for techno stabs isn't fixed even within one article.** Recipe 2's own source starts with lowpass, then in a later variant step switches to bandpass with more resonance for a different flavor of stab — presented as equally valid options rather than a strict progression, i.e. even a single practitioner source treats filter topology as a stylistic choice per-stab rather than a fixed rule.
5. **Compression as "pumping" vs. compression for glue/transient control.** The (lower-confidence) Kerri Chandler compression detail in Recipe 12 uses a **slow attack + fast release** specifically to *preserve* transients while adding release-driven pumping — a fairly specific/advanced combination — whereas Recipe 2's mix-bus chain uses saturation and drum-buss drive (not compression) for stab "glue," and no source in this vein uses a fast-attack/slow-release "safety" compressor on a stab or pad. This isn't a direct contradiction but is worth flagging: no two sources agree on where (or whether) compression belongs in the chord/stab chain.

---

# Notes on Extraction Confidence

- Recipes 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16 were directly fetched and their numeric parameters confirmed against full article body text.
- Recipe 11 (trance supersaw) is a synthesis of consistent claims across a WebSearch cluster (VI-Control, Syntorial, general trance-lead tutorials); individual source pages were not deep-fetched due to session WebSearch budget exhaustion, so treat exact numbers (7.5 cents, 12/6 voice split) as reported-consensus rather than independently re-verified against a single primary document.
- Recipe 12's compression figure (4–5dB, slow attack/fast release) is flagged explicitly as lower-confidence: it appeared in an initial search-result synthesis but could not be located in the direct fetch of either "Kerri Chandler Chords" article body. Treat as directionally correct (attributed to the same article series) but not confirmed verbatim.
- Some leads that looked promising yielded no usable numeric content and were dropped rather than padded with invented values: ADSR Sounds' "FM8 Deep House Chord Stab" and "Dub Techno Synth Stab" tutorial pages (both resolved to site navigation/homepage content on fetch, not the article body — likely JS-rendered or paywalled), Attack Magazine's "What's Up With Filters" (deliberately non-numeric "quick guide"), "The Theory Of Techno Parallel Chord Stabs" (explicitly defers all sound-design detail to the Synth Secrets series and covers only MIDI/arrangement theory), "Further Chords" and "Deep House Chords" (Passing Notes, theory-only beyond the voicing rules already extracted into the Additional Voicing Rules section), the ProductionMusicLive "LFO Plucks" and "Deep Bass Pluck" articles (video-gated — page text is promotional/descriptive only, no parameters extractable), and Sound on Sound's presumed "Synth Secrets: Creating Pluck Sounds" URL (410 Gone — page no longer exists at that path; SoS may have restructured their Synth Secrets archive URLs).
- Attack Magazine's "The Theory Of Techno Pads Part 2" did not resolve to article content on fetch (returned only site navigation) — only Part 1 yielded the 50Hz filter-automation figure now folded into the Additional Voicing Rules section.

## Addendum — direct answers to the fleet coordinator's three priorities

1. **Stab-vs-pad attack/decay in ms:** across every source that gives a real millisecond (not 0–100 dial) value, stab/pluck amp- or filter-envelope **attack is 0ms**, full stop — no source in this pass supports a nonzero 10–30ms attack on the oscillator/filter envelope itself. The "punch" lives in **decay/release length**: as short as ~24–29ms release on a hard techno stab (Recipe 2, Hive dial scale) up to 96.1ms release / 1.25s decay on a softer Zebra 3 pluck (Recipe 16). Pad attacks, by contrast, run **3 to 4 orders of magnitude longer** — 1 second (Recipe 11) to 3 seconds (Recipe 3). The one genuine ~30ms figure found anywhere is a **compressor** attack time on a sustained bass layer (Recipe 14), not a synth envelope — if a build stream is benchmarking a stab/pluck oscillator attack against 12ms vs 30ms, neither number is supported by this corpus; the real target for a stab/pluck attack appears to be 0ms with the perceived "softness" or "hardness" coming entirely from decay/release shaping downstream.
2. **Chord layer architectures (pad + stab + air):** Recipe 14 is the fullest specification found — bass (dry/close-mic mix, pitched −12/−24 st, compressed 30ms attack/20ms release/10:1 ratio), pad (same source instrument, wet/ambient-mic mix inverted from the bass layer, expression-swelled per chord), and stab (a structurally different staccato source patch, detuned second instance ~0.5 semitone down, its own overdrive+compression chain). Recipe 13 gives a simpler two-layer piano+EP / sub-bass split. Recipe 15 gives a register-based (not role-based) 7-layer split across bass/mid/upper registers with deliberately non-parallel voice-leading per layer.
3. **Voicing rules that keep chords out of the bass's way:** root omission (Recipes 5, 12, 13 — the bass alone carries the root), inversion-driven frequency compaction (Lessons From Disco: voicing a triad so it spans a smaller range "gives other instrumental parts more room in the mix"), single-note octave displacement to tighten a spread voicing (Deep House Chords: dropping the 7th an octave), and thinning voicings while preserving the genre-defining tension note (the 7th) rather than cutting it first. See the "Additional Voicing Rules" section above for full detail and verbatim quotes.

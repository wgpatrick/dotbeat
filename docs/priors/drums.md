# Drum Sound Design & Processing Priors — Electronic Music
Vein: kick design/tuning, clap/snare layering, hi-hat character/swing, percussion, drum-bus processing.
Mined from practitioner web sources (Attack Magazine, MusicRadar, EDMProd, SampleFocus, KVR Audio forum). All numbers below are quoted or closely paraphrased from source; anything not quantified in source is marked "(no number given)".

---

## RECIPE 1 — Synthesized sub kick via NI Massive (Attack Magazine "Slave to the Rhythm" pt.3)
- Source: https://www.attackmagazine.com/technique/tutorials/slave-to-the-rhythm-essential-drum-techniques/3/ (Attack Magazine tutorial staff)
- Character: deep synthesized techno/house sub kick, fully programmable pitch-envelope kick (not sample-based)
- Synthesis parameters (NI Massive):
  - Oscillator pitch: **-36.00 semitones (-3 octaves)**, wavetable set to pure **sine**
  - Pitch envelope (1Env) modulation amount: **60.00**
  - Second envelope (2Env) pitch decay: **decay set to just past 1/4 of its range** (i.e., a short/quick pitch drop)
  - Amp envelope (1Env used for shape): attack **0**, decay to **~1/3 position**, decay level **0**
  - 4Env (main amplitude envelope): **same timing as the modulation envelope** (tightly coupled pitch+amp decay — this is the "click into thump" shape)
  - Filter: Lowpass 4, cutoff **fully open**, resonance **0**
  - Saturation (FX1, Classic Tube): Dry/Wet **~45-50%** ("just before halfway"), Drive **~25-30%** ("just past a quarter")
- EQ (internal Massive EQ + external FabFilter Pro-Q2):
  - Massive internal: low shelf **~2/3 boost position**, a boost at **~1/3** amount around a **~1/4-position frequency**, high shelf **maxed**
  - External Pro-Q2: **high-pass roll-off below 20 Hz**; **boosts at 40 Hz and 80 Hz**; six corrective mid cuts at **127 Hz, 167 Hz, 209 Hz, 564 Hz, 750 Hz, 940 Hz** — a comb of narrow cuts to remove unwanted resonant buildup in the low-mids, leaving sub weight (40/80 Hz) and stripping everything between.
- Takeaway: the 40/80 Hz dual-boost + multi-notch mid scoop is a very specific, reusable EQ fingerprint for a synth sub kick.

## RECIPE 2 — 3-layer kick + hi-hat channel-strip build (Attack Magazine "Slave to the Rhythm" pt.1, Ableton Live)
- Source: same tutorial series, page 1 (https://www.attackmagazine.com/technique/tutorials/slave-to-the-rhythm-essential-drum-techniques/3/)
- Layer structure (kick):
  - **Layer 1 "Subby Kick"**: tuned to **C1**, provides low-end weight. Amp envelope: attack **3.97 ms**, decay **60.0 s** (i.e. essentially no decay — sustained sub), sustain **-inf dB**, release **698 ms**.
  - **Layer 2 "Transient Kick"**: high-pass filtered at **271 Hz** (removes overlap with sub layer). Amp envelope: attack **0.00 ms**, decay **347 ms**, sustain **-inf dB**, release **50.0 ms**. Mixed at **-1.5 dB**.
  - **Layer 3 "Hi-hat sample"** (used as a transient/texture layer): high-pass at **2.52 kHz**, envelope attack **0.00 ms**, decay **66.1 ms**, sustain **-inf dB**, release **50.0 ms**, mixed at **-1.2 dB**.
- Takeaway: precise, non-round HPF numbers (271 Hz, 2.52 kHz) show these came from ear-tuned sweeps, not preset defaults — a useful signal that "carve until the layers stop fighting" is the real method, with the exact crossover being sample-dependent.

## RECIPE 3 — Simple Jackin' House kick/clap/hat (Attack Magazine Beat Dissected)
- Source: https://www.attackmagazine.com/technique/beat-dissected/simple-jackin-house/
- Character: jackin'/classic house, 120-125 BPM
- Kick layering: snappy drum-machine hit (LinnDrum/DMX/TR-707/TR-505 family) layered under/over deep 808/909 sample.
  - EQ: cut low end from the **snappier kick below ~150-250 Hz**; cut **highs sharply above 1 kHz** on the 808 sample (classic complementary-band carve so each layer owns its register).
  - Compression: SSL-style bus comp, **fast attack, auto release, ~4 dB gain reduction**.
- Hi-hats: 3 layers — Akai XE8 white-noise hat (amp envelope shortened for tight release), Casio MT500 lo-fi hat reinforcing beats 1-2, TR-909 closed hat carrying ghost hits for groove.
- Clap: gritty Boss DR-202 sample, tight attack/release envelope, **Lexicon 'hall' reverb at ~10% wet**, on beats 2 & 4 plus a ghost variation on turnarounds.
- Master bus: gentle **high-shelf roll-off above 7.5 kHz**, then heavy limiting for loudness without dynamic flattening.
- Groove: **swing 60-65%** at 120-125 BPM.

## RECIPE 4 — Dirty Tech House multi-layer kick + clap stack (Attack Magazine Beat Dissected)
- Source: https://www.attackmagazine.com/technique/beat-dissected/dirty-tech-house/
- Kick — **3 layers, all tuned to the same pitch class**:
  - **Bass Drum** (Drumtrax 04): tuned **down 2 semitones** (plays F#), reduced attack for a tighter hit. Chain: **EQ → Saturn (multiband saturation) → EQ**. First EQ dips low+mid; Saturn splits low/mid-high bands for tone; final EQ applies a **high-shelf dip** to tame transient aggression.
  - **Sub layer** (808 From Mars "BD_Tuned_2_808_E"): pitched **up 2 semitones** to match the bass drum's tuning (net: same pitch class as bass drum, arrived at from opposite direction — a good example of "meet in the middle" tuning). Attack backed off; note length **much longer** than the bass-drum layer (sub sustains, transient layer doesn't). Saturn saturation + slight compression.
  - **Syncopation kick** (used only on specific hits): tuned **one octave above** the primary bass drum, pitch-automated even higher on the final loop hit for a lift/fill effect; transient stripped off, attack backed off; EQ removes both lows and highs (pure mid "thock" for rhythmic accents, not weight).
- Clap stack: LinnDrum clap + Drumtrax clap layered, with **manual delay offset on the Drumtrax layer** to create looseness/width; LinnDrum layer gets a **frequency sweep removing highs and lows** to avoid clashing with its partner layer.
- Snare: sustain shortened for snap; **double-hit fill every 2 bars**.
- Hats: open hats on off-beats, attack backed off slightly, **low/low-mid frequencies swept away**; ride on 8ths with transient fully removed and an LFO-driven amplitude ducking tool applied, plus stereo widening (Stereo Savage).
- Bus processing: Soundtoys Decapitator drive **dialled up moderately**, with a low-cut to sweep off mud, "E" mode for a bright/airy character; Ableton Glue Compressor used in **parallel** with the dry/wet mix control backed off, intentionally "squashed quite heavily" to add punch and control transient tails.

## RECIPE 5 — Deep Tech House kick/snare/hat (Attack Magazine Beat Dissected)
- Source: https://www.attackmagazine.com/technique/beat-dissected/deep-tech-house/
- Kick: 909 sample layered with a shaker sample, **compressed very lightly** just to tighten transients; final tuning deferred until the bassline is written so the kick can be tuned to "play nicely with" the bass — i.e. tune the kick LAST, against the bass, not the other way round.
- Snare (TR-707): high-pass filtered **from ~120 Hz** with a **very sharp** HPF slope; secondary ghost-hit snare is tighter/higher-pitched and mixed low.
- Percussion layer: soft attack transient + short/tight release, Decapitator for grit, heavy HPF to remove low end.
- Hats: acoustic hat sample layered with a wider, more open analogue hit (Roland CR-78) for a live+synthetic hybrid.
- Master bus: SSL Duende bus compressor, **~4 dB gain reduction** target.
- Groove: **125-130 BPM, swing 60-65%.**

## RECIPE 6 — Organic Tech-House 5-layer snare/clap stack (Attack Magazine Beat Dissected)
- Source: https://www.attackmagazine.com/technique/beat-dissected/organic-tech-house/
- Clap/snare built from **five layers**: low-tuned hit, solid machine hit, higher live hit, wide clap hit, high double-hit. **Each layer's start time is individually nudged** so all five land as one perceived hit rather than a smear — explicit micro-timing alignment as the "glue," done by ear/zoom rather than a fixed ms value.
- Hats: 3 layers — hat 1 short/tight, reinforces kick, mixed very low; hat 2 mixed low, adds bulk under hat 3; hat 3 a smooth synthetic semi-open hat carrying the audible pattern. Velocity and note-length interplay across the three is what creates the "slinky" groove feel (not swing alone).
- Groove: **122-129 BPM, swing 50-60%.**

## RECIPE 7 — Dusted Deep House kick/clap/hat (Attack Magazine Beat Dissected)
- Source: https://www.attackmagazine.com/technique/beat-dissected/dusted-deep-house/
- Clap: compression added specifically to "tighten up the clap and give the attack more prominence"; placed on 2 & 4 but **nudged a few ms early** relative to the grid.
- Hats: TR-808 open-hat samples with a **short decay**, triggered on off-beats; ghost hats at lower velocity carry the swing feel.
- Groove: **120-125 BPM, swing 70-80%** — notably higher swing % than the other house recipes in this batch, reinforcing that "dusted"/lo-fi house leans on heavier shuffle than jackin'/tech house.

## RECIPE 8 — Snare processing, 6-technique breakdown (SampleFocus)
- Source: https://samplefocus.com/blog/6-snare-processing-techniques-every-producer-should-know/
- Layering: **body layer ~200-400 Hz** (the "thump"), **crack/transient layer 2-5 kHz** (the "crack") — the canonical two-band snare split.
- Parallel compression: ratio **8:1 or higher** (into limiting territory), **fast attack**, release set to "breathe with the tempo," **low threshold**, parallel blend fader started at **20-30%** of the dry signal.
- Gated reverb: decay **2-4 s** for classic (80s) style, or **0.5-1 s** for a tighter electronic-music version; reverb return **100% wet** (the gate/return itself, blended in underneath).
- Pitch-shift ceiling: shifting samples **more than 3-4 semitones** risks audible artifacts — treat that as the safe tuning range for a snare/clap sample.

## RECIPE 9 — Clap/snare frequency-conflict fixes (KVR Audio forum thread, practitioner consensus)
- Source: https://www.kvraudio.com/forum/viewtopic.php?t=559713 and https://www.kvraudio.com/forum/viewtopic.php?t=314349 (forum practitioners: vurt, Chagzuki, BertKoor, AnX, thecontrolcentre)
- HPF: remove content **below 130-140 Hz** on both clap and snare so they don't fight the kick/bass.
- Clap character sits at **1-2 kHz** — identified by bandpass-sweeping the clap to find where its "identity" lives, then EQ'ing around that band rather than guessing. Verbatim: *"Bandpass the clap and sweep the frequencies to give you a sense of which frequency is most important to it's character, then use that knowledge to EQ more carefully."*
- Presence boost: small boost around **5-10 kHz** on the clap layer to help it cut through and glue with a layered snare.
- Notch technique: cut a **notch in the snare at the frequency where the clap's attack lives**, so the two don't mask each other at the same instant.
- Compression for harsh transient control: fast attack **and** fast release, high ratio, target up to **6 dB gain reduction**, threshold set just above average signal level.
- Timing/panning caveats (important contradiction): panning claps/snares apart is suggested by some, but another practitioner (thecontrolcentre) counters that **mono club systems sum L/R back together**, so panning alone won't reliably separate them in a club playback context — pattern variation or micro-timing offsets are more reliable fixes than panning.
- Verbatim humanization quote: *"Play them both by hand and pray your timing is just a little off. That will separate them just enough."* (BertKoor) — i.e., deliberately imperfect human timing is treated as a legitimate separation technique, not just a flaw to fix.
- Practical worked example from OP: snare's low thud sits **165-530 Hz**, its noise component **4.44-9.9 kHz**; clap occupies **500 Hz-20 kHz** — high-passing the snare's low end while preserving 165-530 Hz thud and letting the clap own everything above ~2 kHz was the reconciliation path.

## RECIPE 10 — Sidechain kick/bass ducking, worked numeric example (EDMProd)
- Source: https://www.edmprod.com/sidechain-compression/
- Primary kick→bass ducking example: **ratio 5:1, attack 4 ms, release 60 ms**, threshold set by ear. Verbatim: *"I'll use a ratio of 5:1, an attack of 4ms (to avoid any clicking, which can happen when sidechaining bass), and a release of 60ms."* — the 4 ms attack is explicitly called out as the number that avoids an audible click artifact; this is the single most load-bearing number in the sidechain recipe set.
- Kick→other-instrument ducking: **ratio 4:1**, fast attack/release (unspecified ms), threshold reduced for an exaggerated pump.
- Kick→snare ducking (subtler use case): **ratio 4:1**, target only **1-2 dB** of gain reduction — a much gentler application than the classic "pumping" bass duck.
- Caveat: sidechain compression is explicitly framed as a tool that "might actually lead you astray" for natural-sounding mixes — use only as a problem-solving or deliberately creative tool, not a default on every channel.

## RECIPE 11 — Sidechain compression, general house/EDM parameter ranges (MusicRadar + Sonarworks/general survey)
- Sources: https://www.musicradar.com/how-to/sidechain-bass-and-drums ; general survey across Sonarworks/EDMProd/MixedInKey blogs
- Ratio: **4:1 to 8:1** for transparent ducking; pushed to **10:1, 20:1 or higher** for the audible "pump" aesthetic common in house/techno/EDM leads and pads.
- Attack: **fast, <10 ms**, commonly **1-10 ms** range.
- Release — two distinct use cases with different numbers:
  - **Short release, 20-75 ms** (or "30-80 ms" per another source) for a **subtle, tight, staccato** duck where the bass snaps back almost immediately.
  - **Long release, 200-500 ms**, tempo-synced, for the **classic audible "pumping"** effect (progressive house/trance breathing quality).
- MusicRadar's specific starting-point numbers: **ratio ~3:1, attack down to 0 ms as a starting point, threshold around -25 (dB)**, then adjust threshold to taste via A/B comparison against the un-sidechained bass.
- Takeaway/contradiction: sources disagree on whether "aggressive" sidechain ratio starts at 5:1 or goes as high as 20:1+; reconcile as "5:1-8:1 = transparent glue, 10:1+ = deliberate audible pump."

## RECIPE 12 — Swing, velocity and humanization conventions (SampleFocus "Swing, Shuffle & Humanization")
- Source: https://samplefocus.com/blog/swing-shuffle-and-humanization-how-to-program-grooves/
- Swing ranges: general usable range **52-70%**; true triplet shuffle = **66.7%**; Logic Pro's Q-Swing "most useful" range **50-75%**; jazz-derived swing tends **55-60%** at faster tempos, **65-70%+** at slower tempos.
- Velocity variation tiers (this is the most directly reusable convention for a groove engine):
  - **Hi-hats: 10-15% velocity randomization**, with closed hats explicitly alternating **~80 and ~100** (out of 127) to mimic a drummer's alternating wrist strokes ("tick-TOCK" feel). Verbatim: *"A hi-hat pattern where every hit is at velocity 100 sounds mechanical regardless of how much swing you apply, because a human drummer physically cannot strike a drum with identical force on every hit."*
  - **Kicks and snares: 5-8% velocity variation** (much tighter than hats — these are the "anchor" hits and shouldn't wander much).
  - **Ghost notes: 40-60% velocity** (i.e. roughly half the level of a primary hit).
- Timing humanization: micro-timing offsets typically **5-20 ms**, randomized per hit but small enough to read as "human," not "sloppy."
- Genre-specific timing note: drum-and-bass hi-hats are sometimes deliberately rushed **5-8 ms early**; DnB groove overall comes more from broken-pattern kick/snare placement than from a global swing %, since the underlying pattern is already syncopated.
- Lo-fi hip-hop: heavier medium-to-heavy swing, **55-60%**.

---

## KICK + BASS COEXISTENCE — cross-source synthesis (the special-interest question)
Combining Recipes 1, 4, 5, 10, 11 and the KVR thread, the consensus workflow is:
1. **Tune the kick to the bass, not the reverse, and tune it LAST** — Recipe 5 explicitly defers kick tuning until the bassline exists so the kick can be pitched to "play nicely" with it. Recipe 4 shows a concrete case of a two-layer kick where one layer is tuned **down 2 semitones** and the sub layer tuned **up 2 semitones**, converging on the same target pitch class from opposite directions — i.e., tune the composite kick's perceived pitch to sit on (or very near) the bass's root/fifth, using octave transposition to avoid an actual clash while keeping perceived "note" alignment.
2. **EQ carve**: the recurring numeric anchor across sources is **~40-80 Hz for kick sub-weight** (Recipe 1's Massive kick boosts exactly at 40 Hz and 80 Hz) with a scooped/notched low-mid band above it (Recipe 1's 127-940 Hz notch comb) to leave room for the bass's harmonic body. Recipe 3's "cut kick below 150-250 Hz on the snappy layer, cut bass sample above 1 kHz" pattern is the complementary-band version of the same idea, generalized: whichever element owns the sub (~40-80 Hz) should have everything above that scooped, and whichever element owns the harmonic/present band should be high-passed clear of the other's territory.
3. **Sidechain as the dynamic-domain solution layered on top of the EQ carve**: attack **4 ms** is the single most load-bearing, specifically-justified number found (avoids an audible click when ducking bass — Recipe 10) with ratio **4:1-8:1** for transparent glue or **10:1-20:1+** for an intentional audible pump, and release chosen by desired feel: **20-80 ms** for tight/staccato snap-back vs **200-500 ms tempo-synced** for the classic "breathing" pump.
4. **Compress the kick itself only lightly** when it's meant to retain full sub weight — Recipe 5's "compressed very lightly, just to tighten transients" and Recipe 3's "~4 dB gain reduction, fast attack, auto release" bus setting are both restrained, not aggressive, suggesting the sidechain (not kick-bus compression) is expected to do the heavy lifting of dynamic separation from the bass.

## GROOVE / SWING / VELOCITY — cross-source consensus
- Swing percentage bands by sub-genre, gathered across the Beat Dissected series: jackin' house 60-65%, deep tech house 60-65%, organic tech-house 50-60%, dusted/lo-fi deep house 70-80%. General DAW-agnostic usable range 50-75%, with true triplet swing at 66.7%.
- Velocity tiering consensus: hats get the most randomization (10-15%, often deliberately alternating two discrete velocity values rather than randomizing continuously), kick/snare the least (5-8%, they're the anchor), ghost notes roughly half-velocity (40-60%).
- Micro-timing humanization in the 5-20 ms range is treated as functionally equivalent to (and sometimes preferred over) global swing settings, especially for separating stacked hits (clap+snare) that would otherwise phase/mask.

## GENERAL CROSS-SOURCE CONSENSUS
1. Kicks and claps are essentially always **multi-layered**, and the layering is resolved with **complementary EQ carving** (one layer owns sub/low, the other owns snap/highs) rather than blending two full-range sounds.
2. **Micro-timing offset of individual layers** (not just swing on the whole pattern) is a named, deliberate technique for gluing multi-sample stacks into one perceived hit (Recipe 6, Recipe 2's non-round HPF values, KVR thread's "play them both by hand" quote).
3. Sidechain attack time is the one number nearly every source treats as make-or-break, converging tightly on **~4 ms** to avoid clicks while still catching the kick's transient.
4. Bus/glue compression on drum groups is consistently **light** (~4 dB gain reduction, fast attack, auto/program-dependent release) — restraint on the bus, not the individual layers, is the norm; aggressive parallel compression is reserved specifically for snares (8:1+, Recipe 8) rather than the whole kit.
5. Saturation (Decapitator, Saturn, tube-style) appears in nearly every kick and drum-bus chain as a standard stage, typically placed **between two EQ stages** (EQ → saturate → EQ) rather than at the very end of the chain.

## CONTRADICTIONS
1. **Sidechain ratio "aggressive" threshold disagrees across sources**: EDMProd treats 4:1-5:1 as already meaningful ducking; MusicRadar's worked example starts at 3:1; the broader survey (Recipe 11) puts "aggressive/pumping" at 10:1-20:1+. There is no single agreed ratio for "the pumping sound" — it spans roughly 5:1 to 20:1 depending on source and desired intensity.
2. **Panning as a clap/snare separation tool**: one KVR practitioner (vurt) suggests panning the two apart; another (thecontrolcentre) directly rebuts this, noting club sound systems frequently sum to mono, nullifying the separation live. No resolution is reached in-thread beyond preferring pattern/timing changes over panning.
3. **Swing % varies 50-80% across nominally similar house sub-genres** in the same Attack Magazine Beat Dissected series (jackin' house and deep tech house both ~60-65%, but "dusted" deep house jumps to 70-80% and organic tech-house drops to 50-60%) — swing is evidently genre-microgenre-specific and not a single stable "house music" number, despite being sourced from the same publication/series using a consistent editorial voice.
4. **Gated reverb decay on snares**: SampleFocus gives two contradictory-sounding targets from the same article — 2-4 seconds for "classic" style vs 0.5-1 second for "electronic" — i.e. the same processing technique (gated reverb) spans an 4-8x range in decay time depending on genre target, so "gated reverb on a snare" alone is not a specific-enough instruction without a genre anchor.

---

## Sources index
- Attack Magazine, "Slave to the Rhythm: 11 Essential Drum Techniques" — https://www.attackmagazine.com/technique/tutorials/slave-to-the-rhythm-essential-drum-techniques/3/
- Attack Magazine, "Simple Jackin' House" (Beat Dissected) — https://www.attackmagazine.com/technique/beat-dissected/simple-jackin-house/
- Attack Magazine, "Dirty Tech House" (Beat Dissected) — https://www.attackmagazine.com/technique/beat-dissected/dirty-tech-house/
- Attack Magazine, "Deep Tech House" (Beat Dissected) — https://www.attackmagazine.com/technique/beat-dissected/deep-tech-house/
- Attack Magazine, "Organic Tech-House" (Beat Dissected) — https://www.attackmagazine.com/technique/beat-dissected/organic-tech-house/
- Attack Magazine, "Dusted Deep House" (Beat Dissected) — https://www.attackmagazine.com/technique/beat-dissected/dusted-deep-house/
- Attack Magazine, "The Secrets of Dance Music Production: Layering Drums" — https://www.attackmagazine.com/technique/tutorials/secrets-dance-music-production-layering-drums/
- Attack Magazine, "Layering Claps and Snares" — https://www.attackmagazine.com/technique/tutorials/layering-claps-snares-tutorial/
- Attack Magazine, "Building Better Beats" — https://www.attackmagazine.com/technique/help/building-better-beats/
- SampleFocus, "6 Snare Processing Techniques Every Producer Should Know" — https://samplefocus.com/blog/6-snare-processing-techniques-every-producer-should-know/
- SampleFocus, "Swing, Shuffle, and Humanization: How To Program Grooves" — https://samplefocus.com/blog/swing-shuffle-and-humanization-how-to-program-grooves/
- MusicRadar, "How to sidechain your bass and kick drum" — https://www.musicradar.com/how-to/sidechain-bass-and-drums
- EDMProd, "Sidechain Compression: 5 Simple Tips for Tighter Mixes" — https://www.edmprod.com/sidechain-compression/
- KVR Audio forum, "4 Ways to Instantly Improve your Claps and Snares" — https://www.kvraudio.com/forum/viewtopic.php?t=314349
- KVR Audio forum, "Clap and Snare Occupying the Same Frequencies!" — https://www.kvraudio.com/forum/viewtopic.php?t=559713
- SoundBridge, "How to Process and Layer Your Claps" — https://www.soundbridge.io/how-to-process-and-layer-your-claps (conceptual only, no numbers extractable)
- Audiotent, "How to layer claps and snares" — https://www.audiotent.com/blogs/production-tips/how-to-layer-claps-and-snares (conceptual only, no numbers extractable)

## Notes on research limitations
- WebSearch quota was exhausted mid-task (shared session budget across parallel research agents), so remaining research relied on WebFetch against known/likely URLs. Several targeted URL guesses (Sound on Sound kick-drum mixing article, theproaudiofiles EQ article, iZotope/Splice/MasteringTheMix kick-EQ pages) 404'd or were paywalled/blocked and could not be retrieved — the recipe count here (12) reflects only sources that were successfully fetched and yielded concrete numbers. A follow-up pass with search access would likely add: Sound on Sound's dedicated kick-drum mixing feature, a named mastering engineer's crest-factor target for kicks, and Sonic Academy/ADSR video-course transcripts.

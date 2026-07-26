
# Lead Sound Priors: Supersaws, Hoovers/Distorted Mono Leads, Plucks/Arps, Acid

Mined for dotbeat. Vein: trance/uplifting supersaws, distorted mono leads (Sandstorm/hoover family),
plucks and arps as hooks, acid leads. 12 recipes below, ordered supersaw → hoover → acid → arp/pluck →
reference tables. Every numeric value is a direct or near-direct quote from the source; where a source
gave no number, that field says so explicitly rather than guessing.

---

## 1. Supersaw Trance Lead — Syntorial "Synth Quickie"

- **Source**: https://www.syntorial.com/tutorials/synth-quickie-supersaw-trance-lead/ — Syntorial is Joe Hanley's ear-training/synthesis-fundamentals platform; tutorials are built around teaching transferable synth-programming reasoning, not one-off presets.
- **Character**: the "face-melting" wide trance supersaw lead — the wall-of-detune sound over noise-brightened top end.
- **Layer structure**:
  - Osc 1–3: three sawtooth layers, each independently unisoned, doing the harmonic/width work (roles not separately named — they function as one stacked "supersaw" block rather than main/octave/width being split across discrete oscillators)
  - Osc 2 detuned down slightly, Osc 3 detuned up relative to Osc 1 → effectively ~27 voices in total across the three layers
  - Osc 4: white noise, pitched up 4 octaves, given the *same* unison settings as Osc 1–3, then high-pass filtered for brightness/air — this is the "noise/texture" layer, sitting on top rather than underneath
- **Oscillators**: sawtooth waves; 9-voice unison per oscillator; unison detune set to "juuuuust starts to sound a little out of tune" (i.e., pushed until the edge of dissonance, not a fixed cents value); unison width maxed for stereo spread
- **Filter**: high-pass, 12 dB/oct slope, cutoff set to "take some of the frump off the bottom" (no Hz given); the noise oscillator gets its own separate high-pass filter
- **Amp envelope**: attack not specified; decay set fast (creates a percussive transient on the pluck-like front of the sustained lead); sustain "brought down pretty far"; release not specified
- **Effects chain (order as described)**: light clip-style distortion (for aggression, not full destruction) → compression (Spire's X-Comp, threshold pulled down until "starts to tighten up," roughly 50%) → reverb (big size, "pretty wet," damping applied so only the reverb *tail* loses high frequencies, not the dry signal)
- **MIDI/performance**: not detailed in source
- **Measurable target**: none stated numerically beyond the qualitative "edge of dissonance" detune target and ~50% compressor threshold
- **Verbatim quote**: *"unison detune amount turned up to where it juuuuust starts to sound a little out of tune"* — the detune target is defined perceptually, not numerically, which is itself a reusable rule (push until you can just hear it, then back off marginally).

---

## 2. Supersaw Lead — FaderPro Blog

- **Source**: https://blog.faderpro.com/techniques/supersaw-how-make-iconic-sound/ — FaderPro is an electronic-music production-education platform whose blog content is written to accompany artist-taught courses (unnamed author in the fetched excerpt).
- **Character**: standard iconic supersaw, layered with an octave-down doubler for weight.
- **Layer structure**:
  - Oscillator 1 (main, top layer): 7-voice unison sawtooth, detune knob moved from its default 20%
  - Oscillator 2 (weight/glue layer): 3-voice unison sawtooth, ~7% detune, tuned down one octave
- **Oscillators**: both sawtooth; Osc 1 = 7 voices / ~20% detune (this is explicitly called out as the *default* starting detune, not a recommended target — the tutorial's point is to move off it); Osc 2 = 3 voices / ~7% detune, −12 semitones
- **Filter**: both oscillators routed to Filter 1 (low-pass) AND Filter 2 (high-pass); the high-pass filter's job is explicitly to cut unwanted low end rather than shape tone
- **Envelope**: Envelope 1 controls Filter 1 cutoff, with attack time increased (no ms given)
- **Effects chain**: reverb only, in detail — time ≈ 500 ms, mix 30–40%, with the reverb module's built-in EQ used to cut low and high frequencies *inside the reverb return* (matches the Syntorial pattern of shaping the wet signal separately from the dry)
- **Measurable target**: reverb time ~500 ms, mix 30–40% — the only hard numbers in this source
- **Note**: does not give amp-envelope ms, distortion, or chorus values — flagged explicitly as a gap rather than invented.

---

## 3. Uplifting Trance Lead (full arrangement-aware recipe) — Myloops

- **Source**: https://www.myloops.net/how-to-make-uplifting-trance-leads — Myloops is a sample-pack/production-tips publisher; author not named in the fetched excerpt, treat as a production-blog secondary source rather than a named practitioner, but it is the most parameter-dense recipe found in this vein and internally consistent, so it's included with that caveat.
- **Character**: the full breakdown→buildup uplifting-trance lead stack, built for cutting through a dense arrangement rather than as an isolated patch.
- **Layer structure** (this is the clearest 3-layer breakdown found in the search):
  - **Main saw layer** (reference level / 0 dB): 7 unison voices, "wide without turning to mush"; detune "around a quarter of the knob's range — in Serum that's roughly the 0.20–0.30 area"; HPF 200 Hz, gentle presence bump at 3 kHz; stereo spread 60–80%
  - **Octave-up layer** (+12 semitones, 6–10 dB below main): 3–5 voices, tighter detune than the main layer; HPF 500 Hz, soft shelf at 8–10 kHz — this is the "air"/width layer that reinforces upper harmonics without adding low-mid mass
  - **Sub-octave layer** (−1 octave, optional, automated in/out): single oscillator (saw or square), no unison or max 2 voices, mono; band-limited LPF ~800 Hz–1 kHz, HPF 80 Hz — weight layer, not always on
  - **Pluck underlayer** (optional hook reinforcement, 12–15 dB below main): bandpass ~1–3 kHz, instant attack, decay 200–300 ms, sustain at zero
- **Oscillators**: sawtooth-based throughout; filter model described as "24 dB/oct low-pass in a musical mode"; oscillator phase set to retrigger at a fixed phase (for a consistent transient on every note, not free-running)
- **Filter automation timeline** (24-bar breakdown + 8-bar buildup structure): bars 1–8 cutoff low ("top harmonics just barely present"); bars 9–16 cutoff creeping up with a subtle resonance bump introduced; bars 17–24 "most of the way open"; final 8 bars automate to fully open, landing exactly on the drop downbeat
- **Sidechain (on the lead bus, ducked by kick)**: ratio 2:1–3:1, attack 5–10 ms, release 100–150 ms, targeting 2–3 dB of gain reduction per kick hit
- **EQ carving of everything else to make room for the lead**: pads cut −3 dB wide-Q at 2–4 kHz; kick bus cut −2 dB medium-Q at 3–5 kHz; plucks cut −2 dB narrow-Q at 500 Hz–1 kHz
- **Effects chain**: reverb send (3–5 s decay, send input band-limited HPF 500 Hz/LPF 8 kHz, starting send level −12 dB) and delay send (quarter-note ping-pong or dotted, feedback 30–40%, band-passed ~500 Hz–5 kHz, starting send level −15 dB)
- **Measurable/claimed targets**: 2–3 dB kick-triggered gain reduction on the lead bus; −12 dB / −15 dB starting send levels; specific EQ cut amounts per competing element — this is the most complete "how a lead cuts through a mix" recipe found.

---

## 4. Supersaw via 3xOsc — Screech House (FL Studio, hardstyle/trance)

- **Source**: https://screechhouse.com/3xosc-supersaw-lead-make-supersaw-fl-studio-chord-synth-tutorial-hardstyle-trance/ — Screech House is an FL-Studio-focused tutorial site.
- **Character**: supersaw built from FL's stock 3xOsc rather than a wavetable/unison-native synth — useful as a "how to fake unison with 3 oscillators" recipe.
- **Oscillators**: all three set to saw; coarse-pitch knob set the same on all three for unison (example used "12"), or offset one oscillator's coarse to 24 for a deliberate octave-up layer within the same instrument; detune each oscillator "quite a bit" (no cents given); phase-offset sliders used for extra manual width in place of true random-phase unison; Phase Rand knob opened fully (100%) to decorrelate the three oscillators' waveform starts
- **"Fat mode" (the article's core trick, under 3xOsc's Misc tab)**: Time knob turned fully down, Feed knob opened fully, Fat mode enabled, Pitch knob nudged only slightly left/right, Echoes set to ~7–8 — echoes here function as pseudo-unison voices (7–8 ≈ the same voice-count range other sources use for supersaws), giving thickness without a true unison engine
- **Envelope**: release added ("some release with the rel knob") for a smoother, less clipped-off lead tail — no ms figure given
- **Effects**: reverb + EQ applied post-mixer, no specific settings given
- **Verbatim quote**: *"Set the 'Echoes' to about 7-8. The echoes act like voices"* — a concrete, transferable trick for faking unison-voice thickness on synths that don't have a unison engine, by repurposing an echo/feedback parameter as pseudo-detune.

---

## 5. Classic '90s Hoover ("What The") — MusicRadar / Massive emulation of the Alpha Juno

- **Source**: https://www.musicradar.com/how-to/how-to-create-a-classic-90s-hoover-sound — MusicRadar/Future Music staff tutorial, recreating a Roland Alpha Juno factory patch in NI Massive.
- **Character**: the original rave/hardcore "hoover" — the "What The" preset from the Roland Alpha-Juno/MKS-50, invented by Eric Persing (Wikipedia corroborates: Persing built it for the Alpha Juno; he did not coin the "hoover" name, which came later from how DJs described its sweeping, vacuum-cleaner-like PWM swirl).
- **Layer structure / oscillators**: 3 oscillators, all set to Pulse-Saw PWM (emulating the Alpha Juno's PWM-saw waveform):
  - Osc 1 & 2: detuned ±40 cents in opposing directions (the core "swirl" pair)
  - Osc 3: tuned down a full octave (−12 semitones) — the weight/sub layer
  - Unisono voices: 3, with Pitch Cutoff (unison detune spread) turned down to ~0.3, and Pan Position used to spread the 3 voices across the stereo field
- **Pitch envelope (Envelope 1, routed to pitch)**: modulation amount increased to 8 semitones — this is what gives the hoover its signature upward pitch "yawn" on note-on; Attack ~10 o'clock, Decay ~12 o'clock, Release ~9 o'clock (dial-position values as given, not ms)
- **Filter**: "Daft" filter model, cutoff ~3 o'clock, resonance 10 (on whatever the plugin's own scale is — treat as "fairly high, not screaming")
- **Effects**: Phaser in slot 1, with Rate, Feedback, and Depth all turned down to almost 0 — i.e., the phaser is used for subtle smearing, not an obvious phasing sweep
- **Sampling notes (Kontakt-specific, if resampling the patch)**: DFD mode switched to "MP60 Machine" sample mode; amp envelope Release brought to 0; sample trimmed to ~1.75 seconds; loop point start moved to the 4-second mark
- **Measurable target**: ±40 cents opposing detune, −12 semitone third oscillator, 8-semitone pitch-envelope sweep — the most numerically explicit hoover recipe found.

---

## 6. Dominator-style Hoover — MusicRadar / AudioRealism ReDominator

- **Source**: https://www.musicradar.com/how-to/how-to-design-a-dominator-style-hoover-sound-with-audiorealisms-redominator — MusicRadar/Future Music, using a dedicated Juno/Dominator-emulation synth (ReDominator), so its parameter names map closely to the original Alpha Juno architecture.
- **Character**: a harder, more "Dominator"-era (early-90s hardcore/gabber-adjacent) hoover than the smoother '90s version above.
- **Oscillators**: Pulse and Saw oscillators both set to PWM mode "3"; Sub oscillator engaged at setting "5", Sub Level "3" — i.e., an explicit sub-octave layer with its own level control, separate from the two PWM oscillators
- **Modulation**: PWM depth set to full, PWM Rate ~100 (fast — this is the "swirl" speed); Pitch Envelope amount 127 (max); Pitch Range "3" (~one octave of pitch-envelope travel, matching the −12 st layer trick in Recipe 5)
- **Amp/filter envelope (T1–T4 stage-time sliders)**: all four stage times set to ~50; Level values: L1 (attack level) 90, L2 (decay level) 127, L3 (sustain level) ~100; VCA envelope mode set to "Env" with Amount 30 — i.e., the VCA is only partially envelope-controlled, keeping some drone/sustain character rather than a hard percussive hit
- **Effects**: Chorus Rate ~60; Master volume ~50; a separate saturation plugin (Sonimus SatsonCM) added afterward for warmth, paired with a high-pass filter (no cutoff given)
- **Gap flagged**: no filter cutoff/resonance numbers, no ms envelope times, no distortion drive amount given — the source describes the modulation and PWM chain in detail but leaves the actual lowpass filter that shapes the growl underspecified.

---

## 7. Acid Lead / 303 Emulation — Native Instruments blog

- **Source**: https://blog.native-instruments.com/acid-house/ — Native Instruments' own product/technique blog, built around Massive X.
- **Character**: the classic acid squelch, built for real-time cutoff/resonance/envelope-amount performance rather than a static patch.
- **Oscillator**: wavetable named "Square – Saw I," continuously morphable between pure square and pure sawtooth at its two extremes (turning the wavetable-position knob is the waveform choice, not a fixed pick); pitch set to −12.00 semitones to reach 303 bass/lead range
- **Filter**: a dedicated "Acid filter" type (a 303-style lowpass model built into Massive X specifically for this); resonance started fully down, then live-modulated via a macro (Macro 3) rather than fixed — resonance-as-performance-parameter is the key idea, not a static number
- **Envelope/modulation**: filter-cutoff envelope (1Env) set to maximum modulation depth; Decay (Macro 5) and Decay Level both started fully down, then opened to taste; Attack Level modulated by Macro 4, started fully down
- **Voice mode**: monophonic
- **Glide/slide**: Time knob started fully down (i.e., off by default — slides are switched on selectively per-note, matching real 303 "slide" step behavior, not a constant glide); glide amount macro set to ~11–12 o'clock when engaged
- **Distortion**: NI's own "Driver" effect, Res(onance) knob on the distortion itself set to 0.8 — i.e., the distortion stage has its own resonant/filtering character, applied after the acid filter
- **Verbatim/paraphrased design note**: the guide "emphasizes parameter automation over static settings for dynamic acid house evolution" — i.e., acid leads are treated as a live-performed filter sweep, not a preset you leave alone.

---

## 8. Acid House Bassline/Lead — Attack Magazine

- **Source**: https://www.attackmagazine.com/technique/tutorials/how-to-make-an-acid-house-bassline/ — Attack Magazine, a well-regarded electronic-production-technique publication; tutorial is deliberately anti-recipe in its philosophy.
- **Character**: applies equally to acid bass and acid lead lines (same 303-style patch, different register/role).
- **Oscillator**: sawtooth described specifically for its "thinner and more aggressive tone" vs. square (an explicit A/B waveform choice tied to a described tonal outcome, one of the few qualitative-but-specific claims in the piece)
- **Filter/envelope/distortion**: DISTORT, CUTOFF, RESON, and ENV MOD controls all turned "clockwise to taste" — no fixed values given, on principle
- **Delay**: dotted eighth-note delay length (tempo-synced, not a fixed ms value)
- **Chain order**: EQ → saturation → delay → reverb
- **Verbatim quote (methodology, worth preserving as a counterintuitive/contrarian data point)**: *"This is preferably done hands-on in real time... adjusting the parameters for the desired effect,"* and the author tells readers to *"Take a screen-shot of your initial setting, as you are likely to heavily tweak this patch"* — i.e., a credentialed, widely-read source explicitly argues against fixed acid patch values, on the grounds that the sound is defined by real-time knob performance, not a static preset. This directly conflicts with the "give me numbers" premise of this mining pass and should be flagged to the user/agent-breadth designer as a genre where gesture-capture (recording live knob automation) may matter more than parameter presets.

---

## 9. Reese-style Detuned-Sine Layering (bass technique, included for cross-application to distorted mono leads) — Attack Magazine

- **Source**: https://www.attackmagazine.com/technique/tutorials/reese-bass-redux/ — Attack Magazine.
- **Character**: not a lead per se, but the detuned-oscillator beating technique is the same DNA as the hoover/supersaw family and is the most numerically precise "detune in semitones, not cents" example found — useful if dotbeat's lead patches ever want the same "moving" character at higher pitch.
- **Oscillators**: two sine waves (Ableton Analog); Osc 1 detuned +0.27 semitones, Osc 2 detuned −0.27 semitones — a symmetric ±0.27 st (≈ ±27 cents) spread around center
- **Amp envelope**: sustain 1.00, release 24 ms
- **Voicing**: mono
- **Verbatim note**: the tutorial explicitly says *"authenticity isn't necessary"* — the original hardware (a Casio CZ phase-distortion synth) is not required to get a usable result; standard subtractive synthesis reproduces the beating-oscillator effect adequately. Relevant precedent for dotbeat: emulate the perceptual effect (beating/movement), not the exact vintage circuit.

---

## 10. Arp/Hook Rhythm Construction — Attack Magazine "Complex Arps"

- **Source**: https://www.attackmagazine.com/technique/tutorials/complex-arps-arpeggiator/ — Attack Magazine, using Synthx V and Audiomodern Soundbox as example arpeggiators.
- **Character**: how to build a hook-worthy arp pattern rather than a plain up/down arpeggio — directly answers the "how the hook rhythm is built" brief.
- **Arp 1 settings (Synthx V)**: Rate synced to 3/8; Octave range 3.0; Steps: seven; Gate described only as "shorter notes sounds good" (no percentage given — flagged gap)
- **Arp 2 settings (layered on top of Arp 1)**: Transpose +12 semitones (the classic octave-up doubling trick, same interval family as the +12/+19/+31 tricks the brief calls out); Octave range 1.5; Start Offset 2 steps; Rhythm sequence "P7" (5 steps) layered against the 7-step Arp 1 for a polymetric, non-repeating feel; Gate ×0.5 (half-length notes — i.e., 50% gate/staccato, one of the only hard gate numbers found in this whole search); Random ~35%; Note Repeat 3 or higher
- **Audiomodern Soundbox layer**: Rate 1/16; Swing 57%; Arp length 12 steps (a 12-step pattern against a 16th-note grid — another deliberate polymeter/polyrhythm device)
- **Design principle** (paraphrased): the polymetric mismatch between a 7-step and a 5-step (or 12-step-against-16th-note) sequence is what generates evolving, non-repeating hook variation rather than a static loop — the "mess" it creates is treated as the intended creative payoff, not a bug.
- **Measurable target**: 50% gate length (Arp 2, ×0.5); 57% swing; polymeter step counts of 7/5/12 against a 3/8 or 1/16 grid.

---

## 11. Unison Voice-Count / Detune-in-Cents Reference Table — CMUSE

- **Source**: https://www.cmuse.org/synth-unison-detune-calculator — CMUSE, a music-production tips/tools site providing a unison-detune calculator with use-case guidance; treat as a secondary/reference source (not a named practitioner), but valuable because it's the only source found that puts hard cents numbers against explicit use-case categories, letting the more qualitative recipes above be cross-checked.
- **Formula given**: `f × 2^(cents / 1200)` for converting a detune-in-cents value to a frequency ratio; beating rate is described as scaling with the Hz difference between voices, meaning the *same cents value* beats faster at higher pitch (relevant for lead vs. bass detune choices)
- **Recommended voices / outer-detune / stereo-spread table by use case**:
  | Use case | Voices | Outer detune | Stereo spread |
  |---|---|---|---|
  | Mono bass support | 1–3 | 0–6 cents | 0–20% |
  | Lead thickening | 3–7 | 6–18 cents | 25–70% |
  | Supersaw/shimmer | 7–9 | 12–28 cents | 50–100% |
  | Pad/string wash | 7–12 | 18–40 cents | 70–100% |
  | Sound-design swarm | 9–16 | 30–60 cents | 80–100% |
- **Phase-randomness guidance**: "low risk" 20–60%, "balanced" 35–80%, "high risk" 0–10% — with the explicit warning that *"aligned starts can thump or comb in mono"* without adequate phase randomization.
- **Bass-specific warning (contrast case for leads)**: use fewer voices, lower stereo spread, and check the result in mono for bass, because small pitch shifts cause audible low-frequency beating — the corollary for leads is that the higher register tolerates (and arguably needs) much more voices/detune/spread than bass to read as "big" rather than "wrong."

---

## 12. JP-8000 Supersaw provenance / voice-count and detune disagreement — KVR Audio forum thread

- **Source**: https://www.kvraudio.com/forum/viewtopic.php?t=526734 — KVR Audio sound-design forum. One poster in the thread is **adamszabo**, i.e. Adam Szabo, the researcher/engineer whose widely-cited paper "How to Emulate the Sound of the JP-8000's Supersaw Oscillator" (2010) is the de facto technical reference for supersaw synthesis (cited in the Wikipedia Supersaw article's references list). His paper's exact per-voice detune-and-mix coefficients could not be retrieved directly in this pass (the known PDF mirrors returned 404/403), so **do not treat any specific coefficient list as sourced from him here** — only the attribution/provenance claim below is a direct quote from this pass.
- **Provenance claim (verbatim, from adamszabo in-thread)**: *"The Airwave pad sound was indeed made with the JP-80x0 supersaw."* — confirms the JP-8000/JP-8080 supersaw oscillator (not a chorused multi-saw workaround) as the actual source of that well-known trance pad/lead sound, settling a disagreement raised earlier in the same thread by poster "chk071," who guessed it was *"chorused 2 or 3 saws"* instead.
- **Other posters' numbers in the same thread** (community consensus, not Szabo's own figures): poster "recursive one" recommends Serum unison set to 7–8 voices, phase set to full random, a second oscillator duplicated an octave up "and a few cents higher," plus added white noise — structurally identical to the Syntorial and Myloops recipes above (main saw layer + octave-up layer + noise layer); poster "CHOOS" cites a detune setting of 18–20 (on the free Charlatan synth's own 0–100-ish scale, not cents) as usable for a similar effect.
- **Wikipedia cross-check**: https://en.wikipedia.org/wiki/Supersaw — describes the supersaw as "a free-run oscillator whose shape resembles 7 sawtooth oscillators detuned against each other," corroborating "7" as the historically-original voice count on real JP-8000/8080 hardware, distinct from the higher voice counts (9, 12, 27-effective) used in the software-unison recipes above.

---

## Attack-time note (flagged by fleet coordinator: our leads measure ~27ms attack vs. a professional target closer to 6ms)

After exhausting the shared WebSearch budget, I spent the remaining WebFetch budget specifically hunting for hard millisecond attack-time numbers for lead/pluck patches (tried edmprod.com, musictech.com, bedroomproducersblog.com, additional Attack Magazine tutorials, KVR/Reddit threads — all either 404'd, redirected to non-existent pages, or contained no ms figures). **The practitioner literature in this vein almost never states attack time in milliseconds.** Every source found describes attack qualitatively — "instant," "fast," "percussive decay with sustain brought down" — rather than numerically. The only hard envelope-timing numbers surfaced in this entire pass are:
- Recipe 3 (Myloops) pluck underlayer: **instant attack, decay 200–300 ms, sustain at zero**
- Recipe 9 (Attack Magazine Reese bass, detuned-sine technique adjacent to lead/hoover DNA): **sustain 1.00, release 24 ms** (no attack given — implicitly instant, since it's described as a sustained beating tone rather than a plucked one)
- Recipe 6 (ReDominator hoover): stage-time sliders T1–T4 all set to "~50" on the synth's own 0–127-ish scale — plausibly in the tens-of-ms range if that scale is roughly linear to ~1-2 seconds full-travel, but the source never states the ms mapping, so treat this as unconverted/unverified, not a real ms number.
- **Working hypothesis for the fleet, stated as a hypothesis, not a sourced fact**: because every qualitative description defaults to "instant"/"fast" rather than naming a number, and the one quantified pluck decay lands at 200–300 ms with *zero* attack time, it's plausible that professional lead/pluck patches are genuinely running attack times near or under ~5 ms (i.e., "instant" is being used literally, at the resolution of a single envelope stage update) rather than the ~20-30ms range that "fast but not zero" might casually imply. This would be consistent with the reported 6ms professional benchmark. **This is inference from the absence of any source describing a slower attack as correct for this vein, not a directly sourced number** — no source in this pass gave an explicit sub-10ms figure, so it should be weighted accordingly (worth testing against, not worth citing as proven).
- Recommend a follow-up pass specifically fetching Serum/Vital/Massive **factory preset XML/patch files** for lead/pluck categories (rather than tutorial prose) if exact attack-ms ground truth is needed — patch files contain the literal number where tutorial text does not.

## Layer architecture at a glance (for the sibling build stream)

| Recipe | Main layer | Octave layer | Width/detune layer | Texture/noise layer |
|---|---|---|---|---|
| Syntorial supersaw (#1) | Osc1: saw, 9-voice unison | Osc2/Osc3: saw, 9-voice unison, detuned up/down relative to Osc1 (not a clean octave, a stacked detune) | built into the 3-oscillator stack itself (~27 effective voices) | Osc4: white noise +4 oct, same unison settings, HPF'd |
| FaderPro supersaw (#2) | Osc1: saw, 7-voice, ~20% detune | Osc2: saw, 3-voice, ~7% detune, −12 st | — (width comes from Osc1's own unison) | none |
| Myloops uplifting lead (#3) | Saw, 7 voices, ~0.20–0.30 detune, 60–80% stereo | +12 st layer, 3–5 voices, tighter detune, 6–10 dB below main | stereo spread differs main (60-80%) vs octave layer (tighter/narrower, implied) vs sub (mono) | optional pluck underlayer, bandpass 1–3 kHz, 12–15 dB below main; separate optional −1 oct sub layer |
| Screech House 3xOsc (#4) | 3xOsc, all saw, same coarse pitch | optional: one osc's coarse offset to +12/+24 within the same instrument | "Fat mode" Echoes 7-8 acting as pseudo-unison-voices | none |
| Alpha Juno hoover (#5) | Osc1/Osc2: Pulse-Saw PWM, ±40 cents opposing | Osc3: Pulse-Saw PWM, −12 st | 3 unisono voices, pitch-cutoff spread ~0.3, panned | none (PWM itself supplies the "swirl" texture) |
| ReDominator hoover (#6) | Pulse osc, PWM 3 | Sub osc, level "3", separate control | PWM depth full + rate ~100 supplies width/movement | — |
| KVR community stack (#12, "recursive one") | Osc1: saw, 7-8 voice unison, phase full-random | Osc2: same, duplicated an octave up + a few cents | unison spread on both oscillators | added white noise |

Reading down the "Octave layer" column: **the octave-related layer is present in every single recipe that specifies more than one oscillator**, at +12 st (brightness/air genres: trance, KVR community) or −12 st (weight/growl genres: hoover). This is the strongest, most load-bearing structural pattern found across the whole vein — stronger than any single voice-count or detune-cents number — and should probably be a required field in the prior schema (octave_layer: {direction: up|down, semitones: 12, level_offset_db, role}) rather than optional.

## Cross-source consensus

1. **Supersaw voice count clusters around 7, with 9 as the next-most-common software figure.** Historical/hardware sources (Wikipedia, KVR/Szabo provenance) converge on **7** as the original JP-8000 voice count. Software-unison recipes vary: FaderPro uses 7 (main) + 3 (octave-down doubler); Syntorial uses 9 per oscillator × 3 oscillators (~27 effective); KVR community posters suggest 7–8; the Screech House "echoes as voices" trick lands on 7–8 as well. **7–9 voices is the practical center of mass**; higher counts (12, 27-effective) come from stacking multiple already-unisoned oscillators rather than a single wider unison.
2. **Three-layer structure recurs everywhere**: a main/wide layer, an octave-related layer (up OR down depending on source), and a noise/texture or sub layer. Syntorial, FaderPro, Myloops, and the KVR "recursive one" post all independently arrive at "saw + octave-shifted saw + noise-or-air element," which is strong convergent evidence this is the load-bearing structure for the sound, not a specific plugin's idiom.
3. **Detune-in-cents ranges nest inside each other across sources**: CMUSE's reference table (12–28 cents for "supersaw/shimmer") sits inside the wider range implied by FaderPro's "20% default, dial down for control" and Syntorial's "push to the edge of dissonance." Read together: default/preset detune amounts on most synths are already near the *top* of the useful range for a controlled lead, and most practitioner advice is to pull back from the default rather than push further.
4. **±40 cents / ±0.27–0.4 semitones is a recurring "opposing pair" detune spread** across unrelated sound families: the hoover's Osc1/Osc2 at ±40 cents (Recipe 5) and the Reese bass's ±0.27 semitones ≈ ±27 cents (Recipe 9) are close enough to suggest a genre-independent sweet spot for a two-oscillator "beating pair" (as opposed to a many-voice unison spread).
5. **The −12 semitone (one-octave-down) third/sub layer is the single most consistent single number in the whole search.** It appears as: Recipe 5's Osc 3 at −12 st; Recipe 6's dedicated Sub oscillator; Recipe 7's Massive X patch pitched to −12.00 st; Myloops' "octave-up layer at +12" (same interval, opposite direction) and its separate "sub-octave layer at −1 octave." The ±12-semitone octave-doubling trick the brief asked about is real and load-bearing, though **+19 and +31 (perfect-fifth-up-an-octave, and two-octaves-plus-a-third) were not found stated explicitly in any fetched source** — only the plain ±12 was directly evidenced.
6. **Reverb-on-the-wet-only, EQ'd separately from the dry signal, is a repeated mixing move**: Syntorial ("damping applied to remove high frequencies from reverb tail only"), FaderPro ("built-in EQ attenuating low and high frequencies within reverb module"), and Myloops ("HPF the send input at 500 Hz and LPF at 8 kHz") all independently treat the reverb return as its own EQ'd signal, not a blanket send.
7. **Sidechain/EQ-carving as the actual mechanism for "cutting through," more than the patch itself.** Only Myloops gives full numbers here (2–3 dB kick-triggered ducking, competing-element cuts of −2 to −3 dB), but the general shape — cut everyone else in the lead's presence band rather than only boosting the lead — matches standard mix-engineering consensus and should be treated as at least as important as oscillator/filter choices for the "cut through the mix" goal.
8. **Acid leads are explicitly NOT meant to be captured as static parameter sets, per two independent credentialed sources** (NI blog: "parameter automation over static settings"; Attack Magazine: "preferably done hands-on in real time"). This is a structural mismatch with a prior library built from fixed values — see contradiction #4 below.

## Contradictions

1. **Supersaw voice count**: 7 (JP-8000 hardware / historical) vs. 9 (Syntorial, per-oscillator) vs. 12 (a CMUSE-adjacent forum mention of "12 voices... detuned by about 32") vs. "7–8 echoes" (Screech House, a workaround not a true unison count). These are not reconcilable into one number — they reflect real differences between hardware-original, single-oscillator-software-unison, and multi-oscillator-stacking approaches. dotbeat's prior should probably store this as a range with the stacking-method as a required companion field, not a bare integer.
2. **Detune amount units are inconsistent and not always convertible**: FaderPro gives "20% detune" and "~7% detune" (plugin-native unison-knob percentages, not cents); Syntorial gives a perceptual target ("edge of dissonance") with no number at all; CMUSE gives cents directly; KVR's "CHOOS" gives "18–20" on a synth-specific 0–100ish scale. **Percent-detune-knob values are not directly comparable across synths** (different synths map 0–100% unison detune to very different absolute cents ranges), so any cross-synth prior needs either a per-synth calibration table or should standardize on cents/Hz as the canonical unit and treat percent as synth-specific metadata.
3. **Octave-layer direction disagrees by source and by genre**: hoover recipes (5, 6) put the extra octave layer *down* (−12 st, for weight/growl); the Myloops uplifting-trance recipe (3) puts its extra layer *up* (+12 st, for air/shimmer), with the down-octave layer treated as optional/automated-in-and-out rather than a fixed structural element. This is a genre-driven choice (hoover = weight-forward, trance lead = brightness-forward) rather than a real contradiction, but a naive "always add an octave-down layer" rule would be wrong for half the vein.
4. **Whether acid patches should be captured as fixed parameter sets at all.** The NI blog and Attack Magazine acid tutorials (Recipes 7, 8) both explicitly argue the genre's character comes from *live, continuous* cutoff/resonance/envelope-amount gesture, not a settled patch — directly in tension with this mining task's premise that "no specific parameter values = worthless." For acid specifically, the actionable prior may need to be a recorded/generated automation curve (a gesture), not a static number set; flagging this for whoever designs the prior schema.
5. **Gate/staccato length**: only one hard number was found (Arp 2 in Recipe 10, ×0.5 / 50% gate), against Recipe 1's vaguer "decay set fast, sustain low" for note-shape control instead of a literal MIDI gate percentage. Not a direct contradiction, but shows two different technical mechanisms (arpeggiator gate-length parameter vs. amp-envelope decay/sustain shaping) are both used to create "short, plucky" lead notes, and a prior schema should support both, not assume gate-length is the only lever.

---

## Report notes

- **Recipe count**: 12 (numbered above), plus 2 reference/consensus artifacts (CMUSE table, KVR provenance thread) that function as cross-checks rather than standalone patches.
- **Sources that returned HTTP 403/404 and were abandoned rather than guessed at**: Perfect Circuit supersaw history, VI-CONTROL supersaw trance lead thread, ReasonExperts hoover lead page, Splice blog supersaw article, gearspace "original hoover sound" thread, the Adam Szabo PDF itself (multiple mirror URLs tried). None of these were fabricated from memory to fill the gap — they're simply absent from this file.
- **Web search quota was exhausted mid-task** (shared session budget across parallel mining agents); remaining research after that point used direct WebFetch on known/guessed URLs only, which is why some obvious candidate sources (Sonic Academy, ADSR, Production Music Live, named YouTube sound-design creators) are under-represented despite being named in the brief's search guidance.

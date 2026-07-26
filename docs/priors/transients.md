# Transient Design, Punch & Dynamics at the Note/Hit Level — Prior Mining

Vein: attack/sustain shaping, envelope design, compression FOR punch, parallel/NY compression,
clipping/saturation as a transient tool, layered transients, and how practitioners measure/judge punch.
Target gap: professional loops peak 5.5dB hotter at matched loudness and have 3-5x faster attacks
(12ms vs 30ms chords; 6ms vs 27ms leads) than our output.

Consensus is marked **[CONSENSUS]** when 2+ independent sources agree; otherwise **[SINGLE SOURCE]**.

---

## 1. Transient Shaper Technique (attack/sustain controls)

**What the controls actually do** [CONSENSUS — iZotope Neutron docs, MusicRadar, iZotope blog, Unison]:
- **Attack** = dB of gain applied to the initial transient portion of the signal (envelope-follower based,
  not frequency-based). Turning it up = "exaggerated and punchy," turning it down = "softer, warmer."
- **Sustain** = dB of gain applied to the body/tail after the transient. Up = "dense, airy"; down =
  "tighter, more aggressive" (shorter perceived decay).
- These act independent of a standard compressor — no threshold, they detect the transient shape itself,
  so they can boost attack AND cut sustain simultaneously (something a compressor cannot do).

**Per-instrument settings found (individual-source numbers, use as ballpark not gospel):**

| Instrument | Attack | Sustain | Source |
|---|---|---|---|
| Kick | +5 to +7 dB | −3 to −4 dB | Unison (unison.audio/transient-shaping) |
| Kick (NI Transient Master) | ~+50% (front-crack push) | reduced to minimum (shorten tail) | MusicRadar |
| Snare | +2 to +5 dB | −5 to −6 dB (kills room sound) | Unison |
| Snare | pulled *down* from peak (de-emphasize snap vs kick) | pushed *up* (restore body) | MusicRadar — context-dependent, opposite direction from the "typical" table above |
| Bass | (attack usually left alone) | +2 dB (retain body, keep attack tight); multiband below 150Hz | Unison |
| Pluck/guitar | +3 to +5 dB | slight reduction (prevents note-blending) | Unison |

**How much is too much** [CONSENSUS across Unison, MusicRadar, iZotope blog]:
- Unison: "+8 dB attack can introduce unwanted clicking artifacts"; general rule "+3 to +5 dB usually
  sounds more natural"; recommends running the effect at **40–60% mix/wet** rather than 100% to avoid
  over-processing.
- MusicRadar: after boosting kick attack, had to EQ-notch 130Hz because aggressive shaping introduced
  "honky" mid-range boxiness — attack boosting has EQ side effects, don't shape in isolation from EQ.
- iZotope blog: warns that softening attack+sustain pushes a sound backward in the perceived mix depth
  ("defined transients sound closer to the listener, smoothed-out transients sound further away") — i.e.
  transient shaping is also a depth/perspective tool, not just a punch tool.
- Universal warning **[CONSENSUS, MusicRadar + iZotope]**: always level-match output gain before judging —
  boosting a transient shaper raises perceived loudness even with no real improvement, producing a false
  positive ("always re-adjust your final output level to match your unprocessed signal's loudness").

---

## 2. Envelope Design for Punch (synth/sample amp & filter envelopes)

Weakest-sourced area — most educational content explains ADSR mechanics but avoids prescriptive ms
values. What was found with real numbers:

- **Pluck/stab patches** [synths.pw]: default **1ms attack / 200ms decay** gives "a snappy pluck right
  out of the box" — cited as a standard percussive-pluck starting point.
- **Pluck length by use-case** [readyformasterclass.com]: tighter/more percussive pluck ≈ **80–100ms**
  decay; sustained plucky lead ≈ **200–300ms**; drop-section plucks ≈ **100–150ms**. Longer decay reads
  as "more musical/legato," shorter reads as "percussive/rhythmic."
- General principle [multiple ADSR explainers, low-confidence]: "fast attack creates punchy sounds, slow
  attack produces smooth swells/pads" — directionally universal but nobody puts a hard ms boundary on
  "fast" vs "slow" for amp envelopes specifically (contrast with the much harder numbers available for
  compressor attack times, below).
- **Amp env vs filter env relationship** [Aulart, single source, low confidence]: filter envelope attack
  determines the timbral "opening" of the sound over time (bright→dark sweep), while amp envelope
  attack determines whether the note is audible at all yet. Key quote: "if you have a very low [fast]
  attack affecting the volume, you cannot expect your filter envelope to solve the problem of little
  presence at the beginning of the note by turning up the [filter] attack" — i.e. **a slow amp-envelope
  attack cannot be fixed downstream by filter envelope tricks; the amp envelope attack time is the hard
  ceiling on how fast a note can feel.** This is directly relevant to the 12ms/6ms vs 30ms/27ms gap: if
  our synth voices use a slow amp-envelope attack stage, no filter-envelope or post-processing move can
  claw back the transient speed lost at that stage.

---

## 3. Compression FOR Punch (not for control)

This is the best-sourced section — strong numeric consensus across Sound on Sound, Korneff Audio,
Pro Audio Files, MasteringTheMix.

**The make-or-break attack-time number** [CONSENSUS, 4 independent sources converge on same range]:

| Source | Fast/"kills punch" | Slow/"preserves or creates punch" |
|---|---|---|
| Sound on Sound (compression-limiting) | 1-5ms fast | 5-20ms lets transient through |
| Korneff Audio | fast attack overshoot deliberately added: "several ms" | — |
| Pro Audio Files | 0-1ms fast | 10-30ms "accentuate snap rather than flatten it"; recommends 15-30ms |
| MasteringTheMix | 10μs-1ms fast, "squash the transient, lifeless, pushed back" | 10-100ms slow, "lets a bit of initial signal through... bigger and more aggressive" |

**Consolidated rule of thumb: ~10-30ms attack is the sweet spot that lets the transient spike through
before gain reduction engages, then clamps the body — this is what reads as "punchy" rather than
"dull."** Sub-5ms (let alone sub-1ms) attack on a percussive/transient-heavy source is what kills punch.

**Per-instrument compressor settings [Sound on Sound "Useful Compressor Settings" table, single
source but internally a named reference table]:**

| Source | Attack | Release | Ratio |
|---|---|---|---|
| Kick/snare | 1-5ms | 0.2s / Auto | 5-10:1 |
| Bass | 2-10ms | 0.5s / Auto | 4-12:1 |
| Vocal | Fast | 0.5s / Auto | 2-8:1 |
| Rock vocal | Fast | 0.3s | 4-10:1 |

**Release times and pump vs breathe** [CONSENSUS]:
- Sound on Sound: release starting point **0.2-0.6s**; too fast → audible "pumping" (level visibly
  breathing up/down).
- MasteringTheMix: fast release = **50-100ms** (drums), slow release = **2-5 seconds**.
- Korneff/general drum-buss convention seen in the parallel-compression numbers below: **50-100ms**
  release is the standard "fast but not pumping" setting for drum-bus/parallel work; **300ms** release
  is the standard for a more "glued," less aggressively pumping parallel effect.

**Ratio guidance for punch** [Korneff Audio, single source but specific and counterintuitive]:
- "Minimum 4:1 for punch; 2:1 typically insufficient" to meaningfully reshape the waveform.
- **Verbatim counterintuitive quote**: *"A high ratio with a very very fast attack time will not be
  punchy at all — in fact it will sound dull and dead."* I.e., ratio and attack time interact: high
  ratio alone doesn't create punch, and can destroy it if paired with fast attack. Punch = ratio high
  enough to matter + attack slow enough to let the spike through.
- **Verbatim counterintuitive quote on knee**: *"Hard knee sounds more punchy, because it more
  radically reshapes the waveform"* than soft knee, despite soft knee having the reputation of being
  the "musical"/smooth choice.
- Korneff also notes opto compressors (LA-2A-style) typically *dull* drum transients despite their
  reputation, because of near-instantaneous attack + soft knee — a case where a "vibe" compressor choice
  actively works against a punch goal.

**The explicit "slow attack to enhance transients" technique with real settings**:
- Korneff Audio, concrete recipe: **kick drum — slow attack ~30ms, medium-fast release 50-100ms**;
  tool example "API 2500 or dbx 160-style: 30ms attack, 50-100ms release, 4:1 ratio."
- Sound on Sound, verbatim: *"Creating a deliberate overshoot by setting an attack time of several
  milliseconds is a much-used way of enhancing the percussive characteristics of instruments such as
  guitars or drums."*
- Pro Audio Files, verbatim counterintuitive framing: *"If punch is lacking, fast attack compression is
  likely going to make the problem worse."* Fast attack compresses the initial transient itself, leaving
  relatively more of the sustain untouched — the opposite of what people assume ("compress harder to
  make it punchier" is wrong; you want the transient *dodging* the gain reduction).

---

## 4. Parallel / NY Compression — exact technique and settings

Directly relevant: engine has an unused dry/wet compressor fan sitting at 0% wet.

**Core technique** [CONSENSUS, Attack Magazine, MusicRadar, MusicGuyMixing, SampleFocus, AudioSpectra]:
Split signal to an aux/bus, crush that bus hard (fast attack, low threshold, near-continuous gain
reduction), blend it back **under** the untouched dry signal. Peak detection mode preferred over RMS
(Attack Magazine) because it reacts to the transient spike itself.

**Concrete settings by source:**

*Attack Magazine (canonical parallel comp recipe):*
- Ratio: 2.5:1, Threshold: very low (near-constant gain reduction), Attack: as fast as possible,
  Release: ~300ms, Detection: Peak mode. Blend level = "a matter of taste."
- Verbatim: *"Simply blend a compressed signal with an uncompressed version of the same thing (hence
  the name 'parallel')."*

*Attack Magazine (advanced buss processing) [SINGLE SOURCE numeric]:*
- Reference blend point ~**40%** wet for a "subtle effect" on a drum buss (paired there with EQ boosts
  at 100Hz and 8kHz, and a saturation/distortion send also around 40%).
- Verbatim on the paradox: *"You get the excitement of the compressed signal plus the dynamics of the
  original."*

*MixingGPT blog (most granular per-source table found — treat as aggregated/single-source but internally
consistent and directionally matches the above):*

| Bus | Compressor | Ratio | Attack | Release | GR target | Blend (wet %) |
|---|---|---|---|---|---|---|
| Drum bus | 1176-style FET | 4:1 (or "all 4 buttons in" ~20:1) | fastest, ≤3ms | fast, 50-100ms | 10-15dB | 20-30% |
| Vocals | 1176-style FET | 4:1 | fast | fast | 10-20dB | 15-25% |
| Bass | LA-2A-style opto | 3:1 | Auto | Auto | 8-12dB | 20-35% |
| Master bus | SSL-style bus comp | 2:1 or 4:1 | slow, 10-30ms | medium, 100-300ms | 2-4dB | 10-20% |

**Key numeric takeaway for our fader**: across sources, the wet blend that reads as "parallel
compression done well" clusters in the **15-35% wet** range for individual sources/busses, with the
drum bus specifically around **20-30%**; **~40%** appears at the high end for a still-tasteful
"aggressive" effect. **100% wet with a hard-crushed setting is explicitly not the target state** —
practitioners always describe blending *under* a dominant dry signal. The single biggest named failure
mode [CONSENSUS, MixingGPT + WaveInformer]: *"blending too much compressed signal"* — WaveInformer:
*"you can literally overdo it... and simply dial back the blend."* This is a "less is the whole
technique" tool, not a binary on/off.

**Perceptual effect** [CONSENSUS]: adds sustain, density, perceived loudness, and "weight" while
*preserving* the transient/punch of the dry path (since the fast-crushed aux mostly rides underneath the
transient rather than dominating it). Described as producing "a subtle dynamic lift" that is "far less
noticeable in action" than straight downward compression despite being audibly denser — the tell is that
it should not sound "compressed," it should sound "bigger."

---

## 5. Clipping / Saturation as a Transient Tool

**Core distinction from limiting** [CONSENSUS, MusicGuyMixing + TensorMix, and this is the more
important/counterintuitive framing]:
- A limiter uses an attack/release **envelope** — it "modulate[s] gain across milliseconds of material
  to catch events that last microseconds," which is exactly the mechanism that causes pumping/dulling.
- A clipper has **no time envelope** — it clips only the instantaneous samples above the threshold,
  leaving everything below untouched. This is why clipping can remove peak energy without touching
  the perceived transient shape/timing the way a limiter does.
- **Verbatim counterintuitive claim (TensorMix)**: *"A clipper that takes 1 dB off the top of a snare
  transient will get you more usable loudness than a limiter pulling 3 dB on the same hit, and it will
  do it without the kick pumping every bar."*

**Concrete amounts:**
- TensorMix: optimal clipping is **1-2 dB** of gain reduction on the loudest peaks; "below 1dB the
  clipper is barely contributing; above 3-4dB you start to hear the distortion." Practical dial-in method:
  "raise input drive until the gain-reduction meter shows 1-2dB on the loudest peaks."
- TensorMix, chain placement: **pre-limiter** in mastering — clip off ~1.5dB so the limiter downstream
  only has to catch ~3dB instead of ~5dB, which is what eliminates audible pumping. Also usable
  **per-track** (e.g., on a kick channel or drum bus) to "tighten transient consistency and add
  character without burning a compressor slot."
- MusicGuyMixing / iZotope Ozone Maximizer soft-clip reference: **L/M/H settings clip at 3dB, 9dB, and
  30dB below the true threshold respectively** — i.e. commercial tools offer clip depths spanning almost
  two orders of magnitude, and the "L" (3dB-below-threshold) setting is the closest analog to the
  1-2dB "just take the tips off" approach recommended above.
- Placement consensus: soft clipping lives at the **very top of the signal, right before/inside the
  final limiter or maximizer stage** (mastering), or optionally per-track on transient-heavy sources
  earlier in the chain. It is described as "commonly used in the mastering stage" specifically to gain
  loudness headroom without hard-clipping artifacts.

---

## 6. Layered Transients (transient-specific slice)

**Frequency split between body and click layer** [CONSENSUS, Onomo + Unison + Big Drum Records]:
- Click/attack layer: **1kHz-5kHz** (Unison) for a kick's "clicky transient layer... definition, cuts
  through a dense mix." Hi-hat/cymbal-based click layers concentrate energy **8-15kHz**.
- Body/sub layer: everything below — roll the highs OFF the sub layer, roll the lows OFF the click
  layer, so each layer occupies exclusive frequency territory ("the sub is only doing low end, the
  click is only doing attack" — Onomo, "Rule #4").
- Practical HPF number: Unison recommends a **250Hz high-pass on the transient/click layer**, removing
  low end so it stays focused purely on attack.

**Level relationship**: not gain-boosted, gain-*reduced* — the click layer is typically mixed in at a
low level under the main body, e.g. Unison's example of "a light closed hi-hat at 15% volume" layered in
purely to add a subtle high-end click without needing EQ enhancement on top.

**Timing/phase alignment** [CONSENSUS, Onomo + Unison — this is treated as the single most important
rule in every layering source found]:
- The transient (first-instant) of each layer must land at **the exact same sample/moment** — misalignment
  "smear[s] into a flabby double-hit" or causes partial cancellation and lost low end (Onomo).
- Practical fix when misaligned: nudge one layer **1-2ms** forward/back, or flip phase on one layer
  (Unison).

**Genre-specific case**: metal kick production (nailthemix) blends a punchy sample with the acoustic kick
specifically so the *sample's* transient can be shaped/EQ'd (3-5kHz for beater click) independent of the
acoustic kick's own (harder-to-control) transient — i.e. layering is also used as an end-run around a
transient that can't be shaped enough in isolation.

---

## 7. The Measurement Side — crest factor, true peak, ear vs meter

**Crest factor benchmarks** [fadelab.net, single numeric source but internally coherent and matches the
mixanalytic/plugg-supply framing found alongside it]:

| Category | Crest factor (peak-to-RMS) |
|---|---|
| Drums (punchy/alive) | 12-20 dB |
| Compressed vocals | 4-8 dB |
| Over-limited masters | 2-4 dB |

- **Verbatim rule of thumb**: *"A crest factor below 6 dB on drums usually means over-compression.
  You've squashed the transients that make drums sound alive."*
- Directly usable diagnostic: **higher crest factor = more transient/punchy**, by definition (bigger gap
  between peak and average). This gives a numeric way to check whether our "hotter but flatter" loops
  are the actual problem: if matched-loudness professional loops are 5.5dB hotter in peak yet still
  sound punchier, their crest factor is almost certainly *higher*, not lower — i.e. they're not just
  compressed up to the same average loudness, their peaks are proportionally further above their own
  average than ours are. That reframes the fix as "raise transient peaks relative to body," not
  "raise average loudness and let peaks follow."

**Ear vs. meter** [CONSENSUS across nailthemix, Attack Magazine advanced-buss article, and the general
tone of nearly every source fetched]: every practical tutorial defers to ear-referenced, level-matched
A/B judgment over meter readings for the *final* call — "always re-adjust output level to match
unprocessed signal" (MusicRadar) and "use reference tracks... to keep your ears calibrated"
(nailthemix) — but crest factor / true-peak numbers are consistently used as a **post-hoc diagnostic**
("did I over-squash this") rather than a target to compose toward. Nobody describes mixing "to a crest
factor number" — the number is used to confirm or debug a decision already made by ear.

---

## Summary — direct answers to the three requested callouts

1. **Consensus compressor attack-time guidance for punch**: roughly **10-30ms** attack is the
   convergent "sweet spot" across Sound on Sound, Pro Audio Files, and MasteringTheMix — fast enough to
   still be a compressor, slow enough to let the transient spike through untouched before gain reduction
   engages. Sub-5ms (and especially sub-1ms) attack on percussive material is repeatedly named as the
   thing that "squashes," "dulls," or "kills" punch. Release consensus: **50-100ms** for "fast but not
   pumping" on drums/parallel busses, 0.2-0.6s general starting point, with pumping onset below ~50ms
   release on fast material.

2. **Typical transient-shaper settings per instrument** (dB of attack/sustain gain, iZotope-style plugin):
   kick +5 to +7dB attack / −3 to −4dB sustain; snare +2 to +5dB attack / −5 to −6dB sustain (context can
   invert this, e.g. pulling snare attack down and sustain up specifically to de-emphasize snap relative
   to the kick); bass mostly sustain-only (+2dB, attack left alone, multiband below 150Hz); plucks +3 to
   +5dB attack with a slight sustain cut. General ceiling: **+8dB attack is where clicking artifacts start
   appearing**; **40-60% mix/wet** is repeatedly recommended over 100% wet.

3. **Most counterintuitive claim found**: *"A high ratio with a very very fast attack time will not be
   punchy at all — in fact it will sound dull and dead."* (Korneff Audio) — directly inverts the naive
   assumption that "more compression = more impact." Close second: TensorMix's claim that a 1dB clip
   produces *more* usable loudness than a 3dB limiter pull on the same transient, because the limiter's
   attack/release envelope is the thing doing the damage, not the gain reduction amount itself — i.e.
   the *mechanism* of gain reduction (instantaneous clip vs. time-based envelope) matters more for
   perceived punch than how many dB are being removed.

---

## Sources (for follow-up / re-verification)

- soundonsound.com/techniques/compression-limiting
- korneffaudio.com/slap-punch-transients-compressors-oh-my/
- theproaudiofiles.com/compressor-attack-release-times/
- masteringthemix.com/blogs/learn/the-secret-to-compressor-attack-and-release-time
- attackmagazine.com/technique/tutorials/parallel-compression/
- attackmagazine.com/technique/tutorials/advanced-parallel-buss-processing/
- mixinggpt.com/blog/how-to-use-parallel-compression-2026 (aggregator, treat numeric table as
  synthesized/illustrative rather than a single named engineer's rule)
- musicradar.com/tuition/tech/how-to-use-transient-shaping-on-drums-600618
- izotope.com/community/blog/how-to-use-transient-shaper-for-better-drum-breaks
- unison.audio/transient-shaping/ and unison.audio/drum-layering/
- s3.amazonaws.com/izotopedownloads/docs/neutron300/en/transient-shaper/index.html (Neutron manual —
  functional description only, no numeric defaults published)
- musicguymixing.com/soft-clipper/ and musicguymixing.com/new-york-compression/
- tensormix.com/blog/soft-clipping-vs-limiting
- fadelab.net/docs/analyze-dynamics/
- onomo.io/blog/how-to-layer-drums
- nailthemix.com/transients
- synths.pw/modules/attack-decay-envelope/ and readyformasterclass.com/how-to-make-plucks-that-cut-through-any-mix/
  (pluck ADSR numbers)
- aulart.com/blog/understanding-amplitude-and-filter-envelopes/ (amp vs filter envelope relationship,
  weakest/thinnest numeric source in this set — flagged as single-source/low-confidence above)

Note: WebSearch quota was exhausted for this session partway through research; all discovery after that
point was done via direct WebFetch of DuckDuckGo HTML results pages, which is a weaker/less-ranked
discovery method than native search — treat source selection as somewhat opportunistic rather than
exhaustively best-in-field, especially for section 2 (envelope design), which remained thin despite
multiple targeted queries.

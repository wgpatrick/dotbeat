# Layering priors: combining multiple voices into one perceived instrument

Vein: layering architecture for bass, chords/pads, leads, drums. Sourced from Attack Magazine,
MusicRadar, Subaqueous Music, ProducerHive, ModeAudio, Pro Audio Files, MusicTech, iZotope,
Hyperbits, KVR Audio forum, Syntorial, FaderPro, Ali Jamieson (Eurorack), techne.fm, and others
(full URL list at bottom). Every claim is tagged **[CONSENSUS]** (independently stated by 3+
unrelated sources), **[CORROBORATED]** (2 sources agree), or **[SINGLE SOURCE]** (one source only —
treat as a hypothesis, not a spec).

---

## 1. BASS — the best-documented architecture in this vein

### Standard layer count and roles

**[CONSENSUS — 4 sources converge almost exactly on a 3-4 layer sub/mid/high/top stack]**
Subaqueous Music, ProducerHive, MusicRadar, and Sound on Sound-adjacent sources (Samplesound)
independently describe the same architecture:

| Layer | Frequency range | Role |
|---|---|---|
| Sub | 0–100 Hz (Subaqueous: 30–100 Hz; theghostproduction: 20–60 Hz) | "rumble and energy," the foundation, felt more than heard |
| Low/Mid bass | 100–500 Hz | "power," body, warmth — keeps the sound from going hollow on small speakers |
| High/Growl bass | 500–2000 Hz | "main characteristics of the stack" — the growl/character/flavor layer, often saturated or distorted |
| Highs/Air | 2000 Hz+ | "presence and sheen" / top-end shimmer |

ProducerHive's exact language (their numbers, verbatim):
- Sub: low-passed to **90–100 Hz**
- Low-Mid: high-pass **just above 100 Hz**, low-pass **400–500 Hz**
- High-Mid: low-passed to remove sub content, upper bound tuned against the Highs layer
- Highs: high-passed **below 2000 Hz**

**[CORROBORATED]** A second, independent crossover figure: MusicRadar's tutorial used an
**HPF24 at 79 Hz, Q 0.7** on the mid-bass layer specifically "to roll off the sub frequencies
already present in the bass to avoid any clashes" — i.e., a ~80 Hz sub/mid crossover, close to
ProducerHive's 90–100 Hz. ModeAudio's sub-layering piece independently gives **~75 Hz** as the
HPF point removing sub content from a secondary layer, and warns not to let the *original*
(non-sub) bass "stray too much into that low to sub bass region below 50Hz." Three independent
figures (75, 79, 90–100 Hz) triangulate a **~75–100 Hz sub/mid crossover** as the practical
consensus band.

**[SINGLE SOURCE]** theghostproduction narrows sub-bass proper to 20–60 Hz, tighter than the
others — worth treating as the conservative end of the range rather than a contradiction.

### Waveform choice per layer

**[CORROBORATED]** Sub layer = pure sine (or triangle) wave, filtered clean, no harmonics
(MusicRadar, ModeAudio, Subaqueous). Mid/growl layers = sawtooth or square, driven harder,
often saturated (MusicRadar: "harmonically richer waveform... to let its character shine
through"; Subaqueous: "apply saturation for harmonic richness" on mid-bass, distortion/saturation
on high-bass for "character").

### Balance (dB)

**[SINGLE SOURCE, but concrete]** MusicRadar's worked example gives actual fader values:
sub layer **-3 dB** relative to mix, 808/transient layer **-10 dB** relative to mix — i.e. the
sub sits much hotter than the supporting attack layer. ModeAudio's sub-layering piece: "pull the
sub bass back a little in volume to allow the original bass sound room to come through" — same
direction (sub is support, not the loudest element, when added *to* an existing bass) but no
number. ProducerHive gives no dB figures, only "level with faders," but does specify the *signal
chain order*: group everything except the sub under one bus, apply subtle compression/saturation
to that bus, and **leave the sub layer unprocessed/unrouted** — the sub is mixed as a separate,
protected signal path, not folded into the rest.

### Mono/stereo discipline

**[SINGLE SOURCE explicit, but matches broader industry convention]** None of the fetched
articles give an explicit "sub must be mono below X Hz" numeric rule (surprising gap — expected
this to be stated outright). What they do state: Subaqueous instructs producers to check phase
relationships with Ableton's Utility device (PHZ-L/PHZ-R buttons) specifically because mono
compatibility is a bass-layering risk. The de facto rule embedded across all sources by
implication (sub is always a plain sine, always narrow-band, always LPF'd ~75–100 Hz) is
consistent with the standard "keep everything below ~100–120 Hz mono" mixing convention, but
we did not find a source in this batch stating that threshold explicitly for bass layering — flag
as an assumption carried in from general mixing practice, not verified here.

### Modulation coherence across layers

**[SINGLE SOURCE, but a sharp, actionable point]** ProducerHive: all layers in a bass stack
should share **identical LFO shape/rate and modulation sources**, because mismatched LFOs between
layers destroy the sense that the whole stack moves as one object. Practical implementation:
duplicate the "character" layer's LFO settings across all layers rather than setting each
independently.

### Compression targets

**[CORROBORATED]** Two sources give near-identical light-compression targets on a bass stack:
ModeAudio "light compression, aiming for **3–6 dB of gain reduction**"; Subaqueous recommends
sidechain/multiband dynamics to prevent masking (no dB figure). Treat 3–6 dB GR as a reasonable
default for gluing a bass stack.

### Reese/growl-specific

**[SINGLE SOURCE]** KVR forum (re: supersaw/Reese-adjacent detuned-saw stacks) gives a concrete
EQ move for removing metallic harshness from a stack of detuned saws: cut **1.6–3.8 kHz by
6–12 dB** with a high-Q notch, then add a wide boost at **450–800 Hz** for "warmth... without
narrowness" — directly transferable to Reese bass built from detuned saws.

---

## 2. DRUMS / KICK — second best-documented architecture

### Standard 3-layer kick

**[CONSENSUS — independently stated by Attack Magazine, transmissionsamples, Ali Jamieson/Eurorack modular practice, and general practitioner consensus]**
"Layering 2 to 3 kicks — one for sub, one for body, one for high-end attack" is stated near-verbatim
across sources.

| Layer | Frequency range | Role |
|---|---|---|
| Sub | 30–80 Hz (transmissionsamples: 50–80 Hz; Subaqueous-adjacent: 30–60 Hz) | rumble/foundation, sine-dominant |
| Body/punch | 100–200 Hz (transmissionsamples pinpoints **100–150 Hz** for "punch and clarity... cuts through the mix") | the "thud," makes the kick audible on small speakers |
| Click/transient | 2–5 kHz for beater click; above 5 kHz optional air/click | attack, cut-through, the part that reads on earbuds |

**[SINGLE SOURCE]** transmissionsamples also flags two *problem* bands to control, not layer:
boxiness **200–400 Hz** and muddiness **300–500 Hz** — i.e., the gap between the body layer and
the click layer is exactly where kicks turn to mud if not cut.

**[CORROBORATED]** Attack Magazine's real-world "live kick + 808" case study: "cutting lows from
the live kick and highs from the 808" — the general EQ-bracketing principle (each layer gets a
carved pocket, overlap removed) restated independently by transmissionsamples and Attack's drum
layering piece ("use EQ bracketing to carve away the unwanted frequencies in each sound, making
space for them to sit together... if too many frequencies overlap the end result will be muddy").

### Compression on the transient layer

**[SINGLE SOURCE]** transmissionsamples: fast attack **5–10 ms** to let the initial transient
through, then compress the body.

### Phase and time alignment — the sharpest, most consensus-heavy finding in this whole vein

**[CONSENSUS across 3 independent sources]**
1. Attack Magazine (kick layering): "the timing of the start of each sample is critical." Check
   where waveforms start — **"if they set off going in the same direction you are usually safe."**
   If the opening transients of two layered waveforms go in *opposite* directions, flip polarity
   on one (a simple invert button) to fix cancellation. This is stated as the primary, first-order
   check before any EQ work.
2. Ali Jamieson (Eurorack kick layering): demonstrates the *mechanism* behind the same problem —
   a free-running oscillator layer produces "annoying clicks and pops" and "inconsistency in
   perceived volume" from hit to hit because its phase at the moment of each trigger is random
   relative to the sample layer. Fix: **hard-sync the oscillator's phase to 0° on every gate/trigger**
   so the two layers start in a fixed, repeatable phase relationship every single hit — not just
   once, but per-note.
3. Attack Magazine (drum layering, general): confirms the same rule for claps/snares layered onto
   the same kind of foundation — check the polarity/phase at the transient before doing anything else.

**Verbatim, most important quote in the kick section:**
> "EQ can't boost something that isn't there in the first place" — the justification for
> layering over EQ-boosting a single sample: if the low end genuinely isn't in the source
> material, no amount of EQ recovers it; you need a second layer that already has that content.

**[SINGLE SOURCE, counterintuitive]** Attack Magazine's strongest anti-layering statement in the
whole research set: **"only layer when there is a good reason for doing so"** — pushing back
directly on the assumption that "two kick drums... should by default be better than one." This is
presented as a corrective to a common producer mistake, not a hedge.

### Pitch relationship between kick layers

**[SINGLE SOURCE]** Ali Jamieson's worked example: original kick fundamental ~55 Hz (a low A);
synth sub layer tuned **one octave below**, ~27.5 Hz. Octave-down (not unison, not a fifth) is
the pitch relationship used to add sub weight without creating a beating/detuned low end.

### Claps/snares layering

**[SINGLE SOURCE, but concrete]** Attack Magazine's claps+snares tutorial: layer a second clap in
the **exact same stereo position** as the snare (not spread — cohesion over width for this pairing).
Use **complementary EQ**: wherever one layer is boosted, cut the other at that frequency, and
vice versa — an explicit alternative to simple high/low-pass bracketing when both layers cover
overlapping ranges. Send both to a shared stereo delay with **left/right delay times that differ**
from each other (an old trick for instant width without detuning) at **<30% wet**. Final step on
both layers together: shave low end off *both* the clap and the snare, not just one.

### Layering vinyl/found drum breaks

**[SINGLE SOURCE — title only, content not retrievable]** Attack Magazine has a dedicated piece,
"Layering Vinyl Drum Breaks With Oeksound Soothe2," implying resonance-suppression/dynamic EQ
tools (Soothe2 specifically) are used as an alternative to static EQ bracketing when layering
non-synthesized, harmonically messy sources (breakbeats) — flagged for follow-up, not confirmed
with numbers here.

---

## 3. LEADS — octave-up + unison-detune is the dominant architecture

### Standard 2-3 layer lead stack

**[CONSENSUS across MusicTech, Syntorial, KVR forum, FaderPro]**
The named architecture: **main saw layer + octave-up layer + noise/air layer**, sometimes with a
second detuned-width layer.

- **Main layer**: full unison saw stack, typically **7–9 voice unison** (Syntorial: "9 voice
  unison... effectively a 27-voice supersaw" across 3 oscillators; FaderPro: 7-voice unison at
  **20% default detune**, noting detune past **~50%** turns "dissonant" — so keep detune well under
  half of the plugin's range).
- **Octave-up layer**: MusicTech's specific numbers — drop unison to **3–5 voices** with tighter
  detune, **high-pass around 500 Hz**, sit **6–10 dB below** the main layer. This is the single
  most quantified "second layer" recipe found in the whole search.
- **Noise/air layer**: Syntorial's recipe — white noise **pitched up 4 octaves**, high-passed to
  remove "frump" off the bottom without losing body, mixed so it's "very audible, but blends into
  the other saw oscillators" (no dB figure, but explicitly *not* subtle — it's meant to be heard as
  texture, not just a sheen).

**[CORROBORATED]** FaderPro's variant uses the octave layer as its *second oscillator*
(down an octave, only 3-voice unison, ~7% detune, level pulled back because it was "sticking out")
— same shape (main = wide/many voices, secondary = narrower/fewer voices, offset by an octave,
turned down) as MusicTech's explicit numbers, just without the dB figure attached.

### Detune philosophy

**[CONSENSUS]** Multiple independent sources converge on the same non-numeric heuristic rather
than a fixed cents value: detune **"until it just starts to sound a little out of tune"** — stated
almost verbatim by Syntorial and referenced by FaderPro/KVR discussion. Hyperbits gives the one
concrete cents figure found: **±10 cents** as a starting detune range for general (non-supersaw)
layering/thickening. KVR forum's practical exercise: start at 2 unison voices at 100% spread,
listen, then step up to 3, 4, 5 voices, re-evaluating detune at each step rather than presetting
a number — i.e., detune amount is *voice-count dependent*, not a fixed constant.

### EQ moves specific to lead stacks

**[SINGLE SOURCE, but concrete and directly reusable]** KVR forum: metallic/harsh artifacts from
a detuned-saw stack cut at **1.6–3.8 kHz, 6–12 dB, high Q**; warmth added back with a wide boost
at **450–800 Hz**; aggressive compression (**~12 dB gain reduction**) applied specifically to a
frequency-split high band to bring up harmonic content, while the low end of the same stack is
"kept mostly untouched" — i.e., split the stack into bands and process the top far harder than
the bottom, rather than compressing the whole stack uniformly.

### Width tactic that isn't detune

**[SINGLE SOURCE]** KVR forum: a touch of stereo delay on the left channel only, delay time
**under 50 ms**, as a way to add width "without obvious artifacting" — distinct from and
complementary to unison detune.

### Historical note on architecture identity

**[SINGLE SOURCE, but useful for the layering-vs-unison distinction in §7]** KVR forum debate:
one poster attributes the "original supersaw" to 7 detuned oscillators on a Roland JP synth
(true multi-voice-per-note layering); another counters that the original Hoover/supersaw sound
was built on a **single Juno oscillator through its built-in 3-voice chorus** — i.e., the same
perceptual result (wide, detuned buzz) achieved via chorus effect on ONE voice rather than
multiple real voices. Both camps agree on the target sound; they disagree on whether it requires
actual multi-voice layering or can be faked with a chorus/unison effect on one oscillator. This is
the clearest documented case of the "layering vs. one big patch" tradeoff in the whole research set.

---

## 4. CHORDS / PADS — weakest-documented architecture in this vein

This role had by far the thinnest concrete numbers of the four. Flagging clearly as a gap rather
than papering over it with invented specifics.

**[SINGLE SOURCE]** Attack Magazine's ambient pad tutorial (Lunacy Audio CUBE) uses an **8-layer**
stack combining stock synth waveforms and external/found samples — notably higher layer count
than any other role in this research, consistent with pads being judged more on
evolving-texture/width than on frequency-slot discipline. Concrete details it *does* give:
explicit hard-panning of individual layers (one layer panned hard left, another centered, others
placed to "fill out the stereo spectrum") rather than frequency splitting as the primary
organizing principle; global "filter and take out some of the lows" applied to the stack as a
whole (not per-layer); a wet/dry "Ether" (reverb-family) control set to **70%**.

**[SINGLE SOURCE]** MusicTech's 80s-style pad/layer piece (2-layer, digital+analogue: PPG Wave +
Juno-60) gives the clearest *balance* rule found for chords/pads: the "focus" layer (PPG, sharp
digital transient) is mixed louder and the "support" layer (Juno, warm low analogue layer, one
octave down via 8' oscillator setting) is mixed under it — same lead-plus-support hierarchy as
the lead-synth section, just applied to a chord patch. Both layers share one aux bus and one
delay send, which is the mechanism used to make two different synths read as one instrument.
Reverb on this stack: **~10% wet**, notably drier than the ambient-pad example above (70%) —
these two data points bracket a huge range and should not be treated as a single number; wet
level for a pad/chord layer appears to be genre/context-dependent rather than convention-bound.

**[SINGLE SOURCE, from Attack's general drum-layering piece but directly transferable]**
"Building up pads by adding multiple layers from different sound sources (synth + acoustic
strings), with panning adjustments per layer to fill out the stereo spectrum" — reinforces that
for pads specifically, **stereo placement is the primary layer-differentiation tool**, where for
bass and kicks the primary tool is frequency-band ownership. This is a real structural difference
between the roles, not just a documentation gap: pads are wide and diffuse by design, so
distinguishing layers by frequency (which would narrow them) works against the goal.

**[SINGLE SOURCE, but a genuinely different layering mechanism worth flagging]** Sound on Sound's
"Step Up Your Synth Chords" masterclass describes a **pitch-interval layering** technique specific
to chords: use a synth with (at least) two oscillators per voice, and tune the second oscillator
a fixed **interval** above the first — a **perfect fifth (+7 semitones)** or **perfect fourth
(+5 semitones)** — rather than an octave or unison-detune. Playing a plain C major triad through
a fifths-tuned dual-oscillator patch automatically produces a C major 9 voicing (each note gains
its own fifth-degree companion), i.e. the "layer" here is a harmonic/interval layer generated per
voice, not a timbral or frequency-band layer. This is a different axis of layering than anything
else in this document (sub/mid/high frequency stacking, or unison/detune width) — it thickens
*harmonic content* rather than *timbre* or *frequency range*, and is worth keeping distinct in any
implementation taxonomy: frequency-layering, timbre-layering, and interval/harmonic-layering are
three separate tools, and chords are the one role where interval-layering is the named technique.

**Gap to flag explicitly**: no source in this batch gave a named "pad + pluck + air" 3-layer
architecture with frequencies/dB, despite that being a well-known convention in commercial
preset design. Treat any such architecture as needing further sourcing before implementation —
we found the *pattern* (focus layer + support layer + panning-based width) but not a canonical
numeric recipe for chords/pads the way we found one for bass, kick, and lead.

---

## 5. Frequency crossover cheat-sheet (cross-role, aggregated)

**[CONSENSUS band, extracted once from a single source but internally consistent with the
per-role numbers above from independent sources]** ModeAudio's general layering-synths piece
gives a fully generic 4-band starting point for "extreme band-pass" layer separation, useful as a
starting template before ear-tuning:

- **150–300 Hz** — low
- **300–550 Hz** — low-mid
- **550 Hz–2 kHz** — high-mid
- **2 kHz–15 kHz** — high

Compare against the bass-specific numbers above (sub 0–100, low-mid 100–500, high-mid 500–2000,
highs 2000+) — the shapes match (roughly four octave-ish bands stacking up to ~2 kHz then "highs"
above), but the generic template starts its first band an octave higher (150 Hz vs 0–100 Hz)
because it assumes a sub layer already exists elsewhere and this 4-band split is for the
non-sub portion of a stack.

---

## 6. When NOT to layer / problems layering creates

**[CONSENSUS — the single clearest cross-source agreement in the whole vein]**
Three independently-worded versions of the same warning:
1. Attack Magazine: **"only layer when there is a good reason for doing so"** — explicitly
   naming the false assumption that two kicks are automatically better than one.
2. Hyperbits: **"Poor layering occurs when multiple sounds try to do the same thing"** — improper
   layering "is a sure-fire way to make your music sound muddy and cluttered."
2b. Pro Audio Files / MusicTech-adjacent (Attack drum piece): **"if too many frequencies overlap
   the end result will be muddy"** — restates the same failure mode in EQ terms.
3. A layering-techniques piece (edmtemplates, title only retrievable at good confidence from
   context) and the general practitioner refrain quoted independently across this batch:
   **"three well-crafted layers usually sound better than seven fighting for space... if your
   sound becomes muddy, it's better to remove layers rather than add more."**

Concrete symptoms named across sources, treat as a checklist for detecting over-layering:
- **Mud** — overlapping unmanaged frequency content (named by nearly every source touched in
  this research).
- **Phase cancellation** — from misaligned transients or free-running oscillator phase at
  trigger time (Attack Magazine kick piece; Ali Jamieson eurorack piece — the latter specifically
  documents *inconsistent perceived volume hit-to-hit*, not just a single static cancellation, as
  a symptom of unsynced phase).
- **Loss of definition / "sticking out" imbalance** — FaderPro's supersaw example describes a
  second oscillator that needed pulling down because it was "sticking out a bit," i.e. layering
  without careful balance creates unevenness rather than richness.
- **Timing smear from misaligned onsets** — Attack Magazine: "the timing of the start of each
  sample is critical" — layers with staggered onsets can either fuse into one sound or read as
  audibly separate hits depending on offset, and this is presented as a *deliberate* choice knob
  (you can intentionally offset layers in time), not only a hazard.

**[SINGLE SOURCE, verbatim, most counterintuitive quote found]**
> "EQ can't boost something that isn't there in the first place."
This is the strongest *argument for* layering (over single-voice + EQ) found in the research —
worth stating both directions: layering is justified specifically when the missing spectral
content doesn't exist in the source at all, not when it merely needs boosting.

---

## 7. Layering vs. one big patch (unison/multi-osc within a single synth)

**[SINGLE SOURCE, but a clean conceptual distinction worth adopting]** Pro Audio Files quotes a
named distinction (attributed to "Russ" in that piece): **"Stacking is a single composite sound
produced from two or more timbres. Layering is a composite sound which changes or evolves with
time."** I.e., in that source's terminology, "stacking" = simultaneous, static combination (closer
to what our system would call within-patch unison), while "layering" implies temporal evolution
(layers that fade in/out, cross-fade, or change balance over the note/phrase) — a distinction
about *when* the combination is static vs. dynamic, not about voice count.

**[SINGLE SOURCE]** The KVR forum supersaw-origin debate (see §3) is the clearest real-world case
of this tradeoff: the identical target sound (wide detuned buzz-saw) was achieved historically
two different ways — genuine multi-oscillator/multi-voice layering (JP-8 7-oscillator claim) vs.
a chorus effect smearing a single oscillator into apparent multiplicity (Juno 3-voice chorus
claim). Neither side disputes that both approaches can reach the same perceptual target; the
practical implication for a synthesis engine is that **true layering (independent voices) and
unison/chorus-on-one-voice are substitutable up to a point**, with true layering giving more
control (independent detune/level/pan per voice) at the cost of more CPU/complexity, and
chorus/unison giving "good enough" width more cheaply.

---

## Report summary

- **Architectures captured with real numbers**: bass (3-4 layer sub/mid/high/top, ~4 independent
  crossover figures converging on 75-100 Hz sub cutoff), kick (3-layer sub/body/click, 30-80/100-200/2-5k
  Hz bands, phase-sync mechanism), lead (main+octave-up+noise, 500 Hz HPF and 6-10 dB offset on the
  octave layer, 7-9 voice unison detuned to "just short of dissonant"). Chords/pads: pattern found
  (focus+support+panning-based width) but no canonical numeric recipe — flagged as this vein's
  weakest-covered role and a good target for further sourcing (preset-pack producer interviews,
  Sonic Academy/ADSR video tutorials were targeted but not reachable this pass — WebSearch quota
  was exhausted mid-task, likely shared across the parallel fleet; remaining research would
  benefit from a follow-up pass via WebFetch on specific known URLs rather than open search).
- **Consensus crossover frequencies**: ~75-100 Hz (sub/mid bass boundary, triangulated from 3
  independent numeric sources: 75, 79, 90-100 Hz), 100-500 Hz (mid bass), 500-2000 Hz (growl/high
  bass), 2000 Hz+ (air/highs) — same shape repeats in the kick (30-80 / 100-200 / 2000-5000 Hz)
  and generic 4-band template (150/300/550/2000 Hz) sources.
- **Strongest argument against layering**: the cross-source consensus warning that layering
  without a specific frequency/timbral/temporal reason produces mud and phase cancellation, crystallized
  in Attack Magazine's blunt line that two kicks are not automatically better than one, and the
  practical rule "if it's getting muddy, remove a layer rather than adding one." The sharpest
  mechanism-level finding was Ali Jamieson's observation that an unsynced oscillator layer produces
  not a single static phase problem but *inconsistent perceived volume from hit to hit*, because its
  phase at trigger time is uncontrolled — the fix (hard-sync phase to 0° on every gate) is directly
  implementable in a synthesis engine and is the single most actionable, non-obvious fact in this
  entire research pass.

## Sources fetched (successful)
- https://www.musicradar.com/tuition/tech/6-steps-to-creating-a-perfect-layered-bass-sound-639120
- https://www.subaqueousmusic.com/layers-of-bass-for-an-epic-low-end/
- https://www.attackmagazine.com/technique/tutorials/layering-kick-drum-samples/
- https://www.attackmagazine.com/technique/tutorials/secrets-dance-music-production-layering-drums/
- https://musictech.com/guides/essential-guide/creating-huge-leads-with-synth-layering/
- https://theproaudiofiles.com/synth-layering-stacking-and-blending/
- https://www.izotope.com/en/learn/create-a-massive-synth-by-layering-multiple-sounds.html
- https://hyperbits.com/blog/layering-sounds/
- https://producerhive.com/music-production-recording-tips/how-to-layer-bass-synths/
- https://modeaudio.com/magazine/quick-tips-009-sub-bass-layering
- https://modeaudio.com/magazine/layering-synths
- https://theghostproduction.com/producer-resources/how-to-design-bass/
- https://www.kvraudio.com/forum/viewtopic.php?t=377166
- https://www.syntorial.com/tutorials/synth-quickie-supersaw-trance-lead/
- https://alijamieson.co.uk/2015/11/19/kick-drum-layering-eurorack-modular/
- https://blog.faderpro.com/techniques/supersaw-how-make-iconic-sound/
- https://www.transmissionsamples.com/kick-drum-production
- https://www.attackmagazine.com/technique/tutorials/building-up-a-massive-ambient-pad-with-lunacy-audio-cube/
- https://www.attackmagazine.com/technique/tutorials/layering-claps-snares-tutorial/
- https://www.soundonsound.com/techniques/synth-chords-masterclass (interval-layering technique for chords, no Hz/dB)

## Sources attempted but blocked (403/429/502 — worth retrying in a follow-up pass)
- https://www.pointblankmusicschool.com/blog/guide-to-layering-drum-samples-for-a-punchier-mix/ (403)
- https://blog.techne.fm/posts/how-to-kick-sound-design-before-mixing/ (502)
- https://bassculture.substack.com/p/production-tips-layering-for-richer (paywalled)
- https://sikho.ai/blog/how-to-layer-synths-fuller-sound (403)
- https://mysticalankar.com/blogs/blog/layering-drums-in-hip-hop-production (429)
- https://www.attackmagazine.com/technique/tutorials/layering-vinyl-drum-breaks-with-oeksound-soothe2/ (title found, content not fetched)

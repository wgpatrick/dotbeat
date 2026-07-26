# dotbeat — executable recipe reference

*Generated from `presets/recipes.json` via `node scripts/gen-recipes-reference.mjs` — **do not
hand-edit**. Edit the library and regenerate, so this file can never drift from the validated
catalog (the `docs/tricks-reference.md` discipline, restated for recipes by research 139 §6.3).
Drive it with `beat recipe list|show|build|check`.*

A **recipe is a layered procedure with a receipt**: layer structure, per-layer patch in dotbeat's
real field names, an effect chain with dosages and order, MIDI/articulation requirements, and exit
gates over metrics the repo already computes. It is one altitude above a **trick** (a single
preconditioned move) and two above a **preset** (a parameter bag with no procedure and no gate),
and it *consumes* both: tricks are its step vocabulary, presets are its patch sources.

**13 recipes** across 4 roles, 25 layers total (10 recipes are genuinely multi-layer).

## How to read a recipe

- **Structure comes from the prose corpus** (`docs/priors/*.md` — nine mined veins, cross-source
  CONSENSUS marked separately from CONTRADICTIONS). **Numbers come from measurement**: research 141
  read 3,559 real Surge patch FILES, and where a tutorial and the patch corpus disagree, the patch
  corpus wins — it measures what designers did, not what they said (research 139 §1.3, pushback 2).
- **Gates are `[lo, hi]` bands, never scalar maxima.** A band cannot be maximized, which is what
  makes it safe to check automatically: metrics may reject and verify, they may never rank the
  survivors. **A failing gate is a FINDING** — either the recipe is wrong for our engine or the
  engine cannot express what the corpus describes — never a reason to widen the band.
- **`pending` gates are honest, not broken.** 24 of 91 clip-level gates name a discriminator
  research 131 §4 measured but `FEATURE_KEYS` does not compute yet (138's B0 upgrade). They report
  `pending`, never silently pass, and no recipe can reach `verified` status while one is open.
- **Sweep dials preserve disagreements** instead of averaging them away. Where sources genuinely
  conflict, the recipe encodes the patch-file median as its value and records the full corpus span
  as an explicit dial — so the disagreement stays visible and sweepable.
- **Gaps are recorded, never faked.** A technique the format cannot express is written down as a
  gap. Two are identity-level: dotbeat has no pitch envelope, so neither the 808's downward dive
  nor the hoover's note-on "yawn" is reachable.

## The sweep dials — every recorded source disagreement in one place

| recipe | dial | field | encoded | corpus range |
|---|---|---|---|---|
| `rolling-sub-bass` | subMidCrossoverHz | `cutoff` | **90** | 75..100 |
| `reese-bass` | reeseDetuneCents | `osc2Detune` | **17** | 7..61 |
| `reese-bass` | reeseCutoffHz | `cutoff` | **700** | 600..4000 |
| `acid-303` | arpGate | `sustain` | **0.35** | 0.18..0.47 |
| `808-glide-bass` | glideSeconds | `glide` | **0.1** | 0.08..0.3 |
| `warm-pad-with-air` | padDetuneCents | `osc2Detune` | **18** | 3..40 |
| `warm-pad-with-air` | padAttackSeconds | `attack` | **0.54** | 0.07..3 |
| `supersaw-trance-lead` | supersawDetuneCents | `osc2Detune` | **10** | 7..28 |
| `supersaw-trance-lead` | unisonVoices | `unisonVoices` | **7** | 3..7 |
| `pluck-delay-lead` | pluckDecaySeconds | `decay` | **0.87** | 0.25..1.28 |
| `hoover-lead` | hooverDetuneCents | `osc2Detune` | **40** | 27..40 |
| `layered-house-kit` | swingPct | `shuffleAmount` | **62.5** | 50..80 |

## Last verification run — every recipe built, rendered and checked

*From `presets/recipe-verify-receipts.json`, generated 2026-07-26 by
`npm run build && node scripts/gen-recipe-receipts.mjs --seed 11 --key Am --bpm 124` (seed 11, key Am, 124 BPM,
offline render).
**44 gates passed, 23 FAILED, 24 pending on 138's B0 feature upgrade.**
0 recipes are clean on every computable gate; 9 have at least one real failure.
A failure here is a FINDING, kept verbatim — the bands are never widened to make this table green.*

| recipe | verdict | pass | fail | pending | what failed |
|---|---|---|---|---|---|
| `rolling-sub-bass` | INCOMPLETE | 5 | 0 | 3 | — |
| `reese-bass` | FAIL | 2 | 3 | 2 | `bandBassPct` 51.97 vs 8..50; `centroidLog2` 7.16 vs 5..6.9; `stereoWidthDb` -20.97 vs -100..-30 |
| `acid-303` | FAIL | 2 | 4 | 0 | `bandSubPct` 0.03 vs 5..55; `centroidLog2` 8.99 vs 5.5..8.5; `crestDb` 23.27 vs 8..17; `stereoWidthDb` -17.26 vs -100..-18 |
| `808-glide-bass` | INCOMPLETE | 5 | 0 | 1 | — |
| `warm-pad-with-air` | FAIL | 2 | 4 | 2 | `bandAirPct` 0.04 vs 0.3..9; `bandBassPct` 74.7 vs 8..42; `bandMidsPct` 24.94 vs 40..85; `bandPresencePct` 0.32 vs 1..20 |
| `house-chord-stab` | FAIL | 1 | 3 | 2 | `bandBassPct` 8.28 vs 10..42; `bandMidsPct` 89.27 vs 40..85; `stereoWidthDb` -21.59 vs -16..-1 |
| `techno-stab` | FAIL | 1 | 3 | 1 | `bandMidsPct` 27.14 vs 35..92; `bandPresencePct` 0.91 vs 1..30; `crestDb` 22.8 vs 11..21 |
| `supersaw-trance-lead` | INCOMPLETE | 6 | 0 | 2 | — |
| `pluck-delay-lead` | FAIL | 3 | 2 | 2 | `bandBassPct` 23.91 vs 0.5..22; `stereoWidthDb` -21.2 vs -16..-1 |
| `hoover-lead` | FAIL | 4 | 1 | 1 | `stereoWidthDb` -18.66 vs -18..-1 |
| `layered-house-kit` | FAIL | 2 | 2 | 4 | `bandMidsPct` 0.69 vs 4..45; `bandSubPct` 70.29 vs 18..55 |
| `three-layer-bass-stack` | INCOMPLETE | 6 | 0 | 2 | — |
| `layered-lead-stack` | FAIL | 5 | 1 | 2 | `bandBassPct` 0.25 vs 0.5..22 |


## The expressibility gaps — what the corpus asks for that dotbeat cannot do

| recipe | gap |
|---|---|
| `rolling-sub-bass` | the source minimises the sub layer's attack with a TRANSIENT SHAPER; dotbeat has no such node (research 138 B1 prices it). A 4 ms amp attack is the nearest available move and is not the same thing — a shaper reshapes an existing transient, an envelope only gates it. |
| `rolling-sub-bass` | the source drives only the mid band (MDMX Screamer at ~35% wet on a band-limited layer). dotbeat's saturator is full-band, so band-selective drive is expressed by driving the mid LAYER and leaving the sub layer clean — the layered equivalent, not the multiband one. |
| `rolling-sub-bass` | 'glue-compress the group' has no expression: BeatGroup is a visual fold with no volume, chain or sends (research 115 §1.2), so cross-layer bus compression needs the two-stage re-host (133 §4d) and a second render pass. |
| `reese-bass` | every Reese source that mentions it requires PHASE RESET on note-on ('turn phase randomization down so both oscillators start at the exact same point' — FutureProof; 'note-on reset enabled' — MusicRadar), because a free-running pair gives inconsistent per-note attack. dotbeat's oscillators expose no per-note phase control. |
| `reese-bass` | multiband saturation split at 400 Hz (Twin 3: low band 30% drive, high band 65%) or 123 Hz (the 808 recipe) is the corpus's near-universal drive strategy. dotbeat's saturator is full-band; the sub/reese layer split is the available approximation. |
| `reese-bass` | 'legato with portamento' is a voice-allocation mode, not a parameter — dotbeat's `glide` applies to every note transition, not only overlapping ones. |
| `acid-303` | filter SLOPE is unexpressible and the corpus disagrees about it anyway (Roland: the real TB-303 is 18 dB/oct; MusicRadar: 24; the Sylenth recipe deliberately switches to 12). dotbeat's `filterType` selects lowpass/bandpass/highpass with no slope control, so the disagreement is moot rather than resolved. |
| `acid-303` | per-step TIE/SLIDE flags — the defining 303 gesture (Sylenth's own sequence ties steps 3, 4, 5 and 8; MusicRadar activates hold on 'certain steps'). dotbeat's `glide` is a voice-level setting, so EVERY note slides here, not only the flagged ones. |
| `acid-303` | odd-length sequencing (13 or 15 steps against a 16-step grid — MusicTech's Chicago-style trick) is not expressible: a .beat figure loops on whole bars. |
| `acid-303` | two credentialed sources argue acid should not be captured as a static patch at all (Native Instruments: 'parameter automation over static settings'; Attack Magazine: 'preferably done hands-on in real time'). The v1 step vocabulary has no `automate`, and clip automation renders only in song mode (133 §3) — so the genre's own experts would call this recipe the wrong shape for the sound. |
| `808-glide-bass` | THE 808's DEFINING MOVE IS NOT EXPRESSIBLE: every source specifies a downward PITCH ENVELOPE at note-on (Unison: 24 semitones over 40–60 ms, exponential; Attack: 'a decaying pitch drop'). dotbeat has no pitch envelope — `lfoDest: 'pitch'` is a cyclic LFO, not a one-shot decay — so this recipe ships the sine, the glide and the long decay WITHOUT the dive. That is an audible, identity-level difference from every 808 in the corpus, and it is the single strongest engine-gap finding in this library. |
| `808-glide-bass` | multiband saturation split at 123 Hz (Attack) — full-band saturator only; the sub/body layer split is the layered approximation. |
| `808-glide-bass` | the −7 ¢ octave-up detune rides on `osc2`, which shares the layer's filter and envelope; Unison's version is a separate voice with its own processing. |
| `808-glide-bass` | the click/transient layer (1–5 kHz, a filtered rimshot under 50 ms) is a SAMPLE in every source; expressing it needs a drums-kind sample host, which is a cross-source stack (139 §3.4 tier 3), not a synth layer. |
| `warm-pad-with-air` | the per-chord EXPRESSION SWELL (an automated CC ramp from ~50% to maximum into every chord change) appears independently in two Attack Magazine pad recipes and is the corpus's main source of pad movement. It needs clip automation, which renders only in song mode (133 §3) and has no v1 recipe step. |
| `warm-pad-with-air` | sample-and-hold random pitch drift (Sound on Sound's string-machine mechanism, chosen specifically to avoid periodic modulation) — `lfoShape` offers sine or custom, with no S&H/random option. |
| `warm-pad-with-air` | reverb PRE-DELAY is named in three pad recipes; dotbeat's reverb is a fixed shared bus with a send level and no predelay control (research 139 §2.3's named gap). |
| `warm-pad-with-air` | Kerri Chandler's root-omission rule ('the keys are not playing the root note, because the bass line has the roots covered') is a VOICING requirement the composed-figure generator does not implement. |
| `house-chord-stab` | Kerri Chandler's two load-bearing voicing rules — 3rd-inversion 7th chords, and omitting the root entirely because the bassline covers it — are figure-level requirements the composed-phrase generator does not implement. Multiple sources call voicing MORE decisive than any synthesis parameter for this genre's identity. |
| `house-chord-stab` | 'the chord part deliberately leaves out beats occupied by the main drum hits' — a rhythmic complement to the kit that a role-solo clip has no kit to complement. |
| `house-chord-stab` | the 'chord baked into oscillator tuning' architecture (0/+3/+7 semitone oscillators, so one key plays a triad) is not expressible: `osc2Detune` is a cents field the GUI narrows to ±100, and there is no third oscillator. |
| `techno-stab` | the source places REVERB FIRST in the DAW chain, ahead of the drive stages, deliberately. dotbeat's reverb is a shared return bus fed after the insert chain, so reverb-before-drive is not expressible at any order. |
| `techno-stab` | 'Drum Buss at 26% drive' used as a bus saturator on a melodic part has no equivalent node; the saturator insert is the nearest move. |
| `techno-stab` | the source automates mod-envelope attack/decay and reverb wet on the FINAL note of the phrase as a deliberate phrase-ending device — per-note parameter automation is not in the step vocabulary. |
| `supersaw-trance-lead` | Syntorial's noise layer is a white-noise OSCILLATOR pitched up four octaves with its own unison and its own high-pass. dotbeat's `noiseLevel` is an unpitched noise mix into the layer's own filter — see `layered-lead-stack` for the three-track form that gets closer. |
| `supersaw-trance-lead` | the lead-bus sidechain (2–3 dB gain reduction per kick, ratio 2:1–3:1, attack 5–10 ms, release 100–150 ms — Myloops's only fully-numbered mix move) needs a ghost-kick track and would duck both layers; omitted so the recipe's only variable is the stack. |
| `supersaw-trance-lead` | the corpus's 24-bar filter-automation timeline (cutoff creeping open bar by bar, landing fully open on the drop) is arrangement-scale automation — clip automation renders only in song mode and is not a v1 step. |
| `supersaw-trance-lead` | band-limiting the reverb SEND (HPF 500 Hz / LPF 8 kHz on the send input, an independently-repeated move in three lead sources) is not expressible: sends are a single scalar into a shared bus. |
| `pluck-delay-lead` | the Zebra 3 recipe's secondary, velocity-sensitive envelope driving the OVERDRIVE stage ~40 ms behind the filter envelope — dotbeat has one filter envelope and one amp envelope, with no third envelope to route at a drive stage. |
| `pluck-delay-lead` | the corpus's band-passed pluck (1–3 kHz bandpass) is expressible via `filterType: 'bandpass'`, but then the SAME filter carries the pluck envelope, so the bandpass and the pluck shape cannot be independent as they are in the source. |
| `pluck-delay-lead` | delay TIME is quoted as a tempo-synced division (dotted eighth) in every source; `pingPongTime` and the shared delay bus are in seconds, so the sync is an unsourced BPM conversion. |
| `hoover-lead` | THE HOOVER'S SIGNATURE IS NOT EXPRESSIBLE: both sources route a PITCH ENVELOPE (8 semitones in one, ~an octave at maximum amount in the other) to produce the upward 'yawn' on every note-on. dotbeat has no pitch envelope; `lfoDest: 'pitch'` is a cyclic LFO, not a one-shot. What ships here is a PWM swirl with a wide detuned pair — recognisably hoover-adjacent, and missing the move that names the sound. |
| `hoover-lead` | the source runs THREE PWM oscillators; `osc2Type` has no 'wavetable' entry (engine.ts falls a wavetable osc2 back to a plain sawtooth — ui/src/components/synthParams.ts's own note), so each layer here is one PWM oscillator plus a saw partner, not a PWM pair. |
| `hoover-lead` | the source pans the three unison voices individually across the stereo field; `unisonWidth` is a single spread scalar with no per-voice placement. |
| `layered-house-kit` | the corpus's actual kick/clap/hat construction is 2–5 SAMPLES per hit with complementary EQ carving per layer (Attack's tech-house kick is three tuned layers; its snare stack is five). dotbeat's drums track is ONE voice bus over five lanes, so the 'layering' expressible here is per-lane voice tuning, not per-hit sample stacking — the biggest structural gap in this recipe. |
| `layered-house-kit` | per-layer MICRO-TIMING offsets of 5–20 ms, named across three sources as the glue that fuses a multi-sample stack into one perceived hit — hits sit on a 16th grid and `humanize` is a CLI verb, not a v1 recipe step. |
| `layered-house-kit` | 'ghost notes at 40–60% velocity' and hat velocity ALTERNATION (~80/~100 out of 127, the 'tick-TOCK' wrist-stroke feel) are per-hit patterns; the builder applies velocity by metrical position only. |
| `layered-house-kit` | there is no group bus (research 115 §1.2), so the ~4 dB glue compression is the track's own comp insert rather than a real drum-bus compressor. |
| `layered-house-kit` | MEASURED TRAP, found by verifying v1: `kickPunch` is not a 0–1 'amount' despite the GUI rendering it as a percentage knob (ui/src/components/synthParams.ts: `k('kickPunch','KickPch',0,1,fmt.pct)`) — it is Tone.MembraneSynth's `pitchDecay` in SECONDS, over a 7-octave pitch sweep (ui/src/audio/engine.ts:2179/3390). v1 shipped 0.35, i.e. a 350 ms fall from ~5.8 kHz to 45 Hz under a 320 ms amp decay, and the loop measured 1.49% sub share against an 18–55% gate — a kick with essentially no sub. v2 uses 0.015, the sourced 10–20 ms drop. Any recipe or preset author reading the GUI will make the same mistake. |
| `three-layer-bass-stack` | ProducerHive's central routing instruction — bus everything except the sub and glue-compress that bus — needs a group bus, which BeatGroup is not (research 115 §1.2). The two-stage re-host (133 §4d) can do it in a second render pass; this single-pass recipe cannot. |
| `three-layer-bass-stack` | the corpus's fourth 'highs/air' layer above 2 kHz is omitted deliberately: at 2 kHz+ over a bass fundamental it is a texture source, and the same three sources that name it give no numbers for it. Adding a fourth layer would be exactly the 'seven fighting for space' failure §6 warns about. |
| `three-layer-bass-stack` | the light glue compression the corpus specifies (3–6 dB gain reduction across the stack — ModeAudio, corroborated) is applied per-layer here, which is a different sound from bus compression on the sum. |
| `layered-lead-stack` | Syntorial's noise layer is PITCHED white noise (up four octaves) with its own unison stack. dotbeat's `noiseLevel` mixes unpitched noise into the layer's own oscillator path, so what ships here is a high-passed triangle+noise voice two octaves up — closer than a single-voice patch can get, and still not the same generator. |
| `layered-lead-stack` | 'the same unison settings as Osc 1–3' cannot be honoured exactly: the noise mix rides the layer's single oscillator bank, so its unison spread is the layer's, not a per-source setting. |
| `layered-lead-stack` | the corpus's band-split compression on lead stacks (KVR: ~12 dB gain reduction on a frequency-split HIGH band while the low end of the same stack is 'kept mostly untouched') is a multiband move; the per-layer split here is the layered approximation. |


## Bassline — register and low-end steadiness (research 131 §7 P1, the largest single per-role gap)

### `rolling-sub-bass` v1

*The warehouse rolling bass: a clean mono sine sub under a saturated, band-limited mid voice, both ducked by a ghost kick, with the first 16th of every beat left empty for the kick.*

- **tags** — techno, tech-house, warehouse, dark, rolling
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `rolling-8ths`, register MIDI 28..33
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.78 / 0.6 by metrical position
    - gate ×0.85
    - **rest on every beat-1 16th** (kick clearance)
    - no source in the techno-bass vein gives a numeric swing percentage for bass programming (docs/priors/bass-techno.md, GAPS) — the figure is left straight rather than swung to an invented number
    - the source varies velocity across 'nearly every remaining 16th'; the tiering here is metrical (bar / beat / off-beat), not the per-hit variation the source describes
- **layers** (2)
    - **`sub`** — synth, production role `sub`
        - *why*: the foundation: a pure mono sine low-passed at the consensus crossover and kept out of the drive chain — ProducerHive's 'leave the sub layer unprocessed/unrouted' rule, and the only layer that answers 131's 60.1%-vs-0.22% sub-share gap.
        - *patch*: `osc`=sine, `subLevel`=0.5, `attack`=0.004, `decay`=0.3, `sustain`=0.95, `release`=0.03, `cutoff`=90, `resonance`=0.1, `filterEnvAmount`=0, `unisonVoices`=1, `unisonWidth`=0, `chorusMix`=0, `sendReverb`=0, `pan`=0, `volume`=-6
        - *solo gates*: `bandSubPct` 45..100, `stereoWidthDb` -100..-35
    - **`mid`** — synth, +12 semitones, production role `bass`
        - *why*: the audible bassline: saw+square through a low, envelope-driven filter, saturated and bracketed 65–350 Hz so it never competes with the sub — the source's own EQ window, and the layer that carries the 'transient audibility' the fast filter envelope exists for.
        - *patch*: `osc`=sawtooth, `osc2Type`=square, `osc2Level`=0.35, `osc2Detune`=8, `cutoff`=350, `resonance`=1.2, `attack`=0.004, `decay`=0.12, `sustain`=0.35, `release`=0.03, `filterEnvAmount`=0.55, `filterEnvAttack`=0.002, `filterEnvDecay`=0.09, `filterEnvSustain`=0, `unisonVoices`=1, `unisonWidth`=0, `saturatorCurve`=warm, `saturatorDrive`=0.35, `saturatorMix`=0.35, `eq7HpOn`=true, `eq7HpFreq`=65, `eq7LpOn`=true, `eq7LpFreq`=350, `pan`=0, `volume`=-9
        - *solo gates*: `bandBassPct` 25..75, `bandSubPct` 0..25
- **chain** (clip level, in order)
    - `track-add pump` (drums, kick-quarters, -60 dB)
    - `effect-add $mid eq7`
    - `set $sub.duckSource pump`
    - `set $sub.duckAmount 0.4`
    - `set $mid.duckSource pump`
    - `set $mid.duckAmount 0.4`
- **sweep dials**
    - **subMidCrossoverHz** (`cutoff`) = 90, range 75..100 — three independent figures triangulate the sub/mid crossover: ModeAudio ~75 Hz, MusicRadar HPF24 at 79 Hz (Q 0.7), ProducerHive 90–100 Hz. No patch corpus measures a crossover, so this is a genuine prose consensus BAND, and 90 sits inside all three.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - the source minimises the sub layer's attack with a TRANSIENT SHAPER; dotbeat has no such node (research 138 B1 prices it). A 4 ms amp attack is the nearest available move and is not the same thing — a shaper reshapes an existing transient, an envelope only gates it.
    - the source drives only the mid band (MDMX Screamer at ~35% wet on a band-limited layer). dotbeat's saturator is full-band, so band-selective drive is expressed by driving the mid LAYER and leaving the sub layer clean — the layered equivalent, not the multiband one.
    - 'glue-compress the group' has no expression: BeatGroup is a visual fold with no volume, chain or sends (research 115 §1.2), so cross-layer bus compression needs the two-stage re-host (133 §4d) and a second render pass.
- **sources**
    - *[single source — a hypothesis]* [Attack Magazine — Warehouse-Style Rolling Techno Basslines (Aykan Esen, 2020)](https://www.attackmagazine.com/technique/tutorials/warehouse-rolling-techno-bass/) — explicit three-layer split: sub low-passed ~80 Hz with attack minimised and ~35% overdrive; bassline layer high-passed 65 Hz / low-passed 350 Hz with a fast attack and fast filter envelope 'for transient audibility'; and, verbatim, 'leaving the first 16th-note of every beat empty is important to prevent clashing with the kick'
    - *[consensus (3+ sources)]* docs/priors/layering.md §1 — bass layer architecture — four independent sources converge on a sub / low-mid / growl / air stack, and three independent numeric figures (75, 79, 90–100 Hz) triangulate the sub/mid crossover
    - *[consensus (3+ sources)]* docs/priors/bass-techno.md consensus 7 — fast/zero amp attack is standard for plucky/rolling bass, paired with a short but NON-zero release (20–30 ms) specifically to avoid clicks rather than to add sustain
    - *[measured — patch files]* docs/research/141 §8 — bass row, 494 patches — bass amp attack ≤12 ms covers 83% of professional patches (median 3.91 ms = the machine floor), release ≤250 ms covers 75%, filter cutoff knob p25–p75 76–732 Hz, waveshaper on in 63%
    - *[measured — owned refs]* docs/research/131 §7 P1 + §2.2 — the gate numbers: packs-ref bass puts 60.1% of energy below 60 Hz (p25 ≈37) with centroid ≈74 Hz and dead-mono width; engineplus sits at 0.22% sub and 162 Hz
    - *[measured — owned refs]* docs/research/138 §2 free wins 1, 2, 5, 9 — subLevel 0→0.5, bass root E1–A1 (MIDI 28–33), bass mono discipline, and the ghost-kick pump track (duck reads kick HITS, so a −60 dB ghost track works today)

**Clip gates** (checked on the summed render) — last verified run: **INCOMPLETE**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandSubPct` | 30..78 | computable today | 51.79 | **PASS** |
| `bandBassPct` | 8..50 | computable today | 46.86 | **PASS** |
| `centroidLog2` | 5..6.8 | computable today | 6.11 | **PASS** |
| `stereoWidthDb` | -100..-35 | computable today | -64.33 | **PASS** |
| `crestDb` | 7..16 | computable today | 12.97 | **PASS** |
| `crest_subDb` | 0..12 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `attackMedMs` | 0..15 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `fluxMean` | 0.08..0.35 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §7 P1 (packs-era ref medians, 61 ref-beat-engineplus pairs) + 138 §2 rows 1/2/5 — packs-ref medians widened to the p25–p75 band the doc quotes, as of 2026-07-26.*

### `reese-bass` v1

*Two detuned saws beating against each other over a clean mono sine sub, low-passed and slowly LFO-swept — the beating IS the sound, and its rate is the detune.*

- **tags** — dnb, jungle, neurofunk, dark
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `sparse-sub`, register MIDI 28..33
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.9 / 0.78 / 0.66 by metrical position
    - gate ×1
    - the Reese is a SUSTAINED tone whose interest is the beating, so the figure is long notes with almost no gating — the opposite of the rolling recipe
    - 'a static Reese patch is considered a design failure' (Dystopian Collective): the movement here is a 1/1-synced filter LFO, which is the slowest division the format offers (the source asks for 1 bar to 4 bars)
- **layers** (2)
    - **`sub`** — synth, production role `sub`
        - *why*: the mono sine foundation every Reese source splits out, kept below the 80–120 Hz crossover and out of the drive chain so the detuned pair never beats in the sub band (where beating reads as level instability, not movement).
        - *patch*: `osc`=sine, `attack`=0.004, `decay`=0.4, `sustain`=0.95, `release`=0.024, `cutoff`=120, `resonance`=0.1, `filterEnvAmount`=0, `unisonVoices`=1, `unisonWidth`=0, `chorusMix`=0, `sendReverb`=0, `pan`=0, `volume`=-6
        - *solo gates*: `bandSubPct` 45..100, `stereoWidthDb` -100..-35
    - **`reese`** — synth, +12 semitones, production role `bass`
        - *why*: the Reese proper: two saws detuned by the measured-patch median, four unison voices for extra beating partials, low-passed with a whole-note filter LFO so the tone evolves — high-passed at the crossover so the beating never reaches the sub.
        - *patch*: `osc`=sawtooth, `osc2Type`=sawtooth, `osc2Level`=0.9, `osc2Detune`=17, `unisonVoices`=4, `unisonWidth`=0.35, `cutoff`=700, `resonance`=2.5, `attack`=0.004, `decay`=0.4, `sustain`=0.9, `release`=0.024, `filterEnvAmount`=0.2, `filterEnvDecay`=0.3, `filterEnvSustain`=0.4, `lfoDest`=cutoff, `lfoSync`=true, `lfoSyncRate`=1/1, `lfoDepth`=0.35, `saturatorCurve`=analog, `saturatorDrive`=0.4, `saturatorMix`=0.4, `eq7HpOn`=true, `eq7HpFreq`=100, `pan`=0, `volume`=-10
        - *solo gates*: `bandBassPct` 20..75, `bandSubPct` 0..22
- **chain** (clip level, in order)
    - `effect-add $reese eq7`
    - `set $reese.eq7LpOn true`
    - `set $reese.eq7LpFreq 3000`
- **sweep dials**
    - **reeseDetuneCents** (`osc2Detune`) = 17, range 7..61 — the corpus's loudest single disagreement: ±27 ¢ (Attack, sines), ±30 ¢ (Native Instruments), ±55–61 ¢ (MusicRadar 'Terrorist'), −30/+50 ¢ asymmetric (Noise Masters), ±7 ¢ (Attack/Twin 3, over a separate sine sub), '5–10 subtle / 25–50 neurofunk' (Dystopian). Two sources claim to describe the same DnB Reese and disagree ~5×. research 141 measured 494 real bass patches: median 16.6 ¢ at ≥5 voices, and ±61 ¢ is the 97th percentile of 1,426 stacks. The patch files win; 17 is encoded and the full span is the sweep.
    - **reeseCutoffHz** (`cutoff`) = 700, range 600..4000 — cutoff for a nominally-identical dark DnB Reese ranges an order of magnitude across sources: 600 Hz (Twin 3), 650 Hz (NI), 1–3 kHz (Dystopian), ~4 kHz (MusicRadar). research 141's bass cutoff-knob p25–p75 is 76–732 Hz, so the low end of the tutorial span is where designers actually sit; 700 is the encoded value.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - every Reese source that mentions it requires PHASE RESET on note-on ('turn phase randomization down so both oscillators start at the exact same point' — FutureProof; 'note-on reset enabled' — MusicRadar), because a free-running pair gives inconsistent per-note attack. dotbeat's oscillators expose no per-note phase control.
    - multiband saturation split at 400 Hz (Twin 3: low band 30% drive, high band 65%) or 123 Hz (the 808 recipe) is the corpus's near-universal drive strategy. dotbeat's saturator is full-band; the sub/reese layer split is the available approximation.
    - 'legato with portamento' is a voice-allocation mode, not a parameter — dotbeat's `glide` applies to every note transition, not only overlapping ones.
- **sources**
    - *[single source — a hypothesis]* [Attack Magazine — Reese Bass Redux](https://www.attackmagazine.com/technique/tutorials/reese-bass-redux/) — the minimal form: two oscillators at +0.27 / −0.27 semitones (±27 ¢), mono, sustain 1.00, release 24 ms — and the mechanism, 'the tempo of [the harmonic movement] can be controlled by adjusting the fine tuning'
    - *[single source — a hypothesis]* [MusicRadar — How to make a classic Reese like Renegade's 'Terrorist'](https://www.musicradar.com/how-to/classic-reese-bass-renegade-terrorist) — ±55 ¢ (a ±61 ¢ variant tuned so the beating locks to the track BPM), 24 dB/oct low-pass at ~4 kHz with low resonance, legato with portamento, a separate sub oscillator plus a high-pass on the main signal 'to manage phase cancellation artifacts'
    - *[single source — a hypothesis]* [The Dystopian Collective — How to Create Reese Bass: The Complete Guide](https://www.thedystopiancollective.com/tutorials-2/how-to-create-reese-bass-the-complete-guide-to-the-iconic-drum-amp-bass-sound) — sub layer completely mono with an 80–120 Hz crossover, mid layer high-passed at the crossover, detune 5–50 ¢ by aggression, 24 dB/oct LP at 1–3 kHz with 20–40% resonance, slow LFO (1/4 to 1 bar) because a static Reese 'becomes boring quickly'
    - *[consensus (3+ sources)]* docs/priors/bass-basseries.md consensus 1–4 — Reese = 2+ detuned oscillators run mono through a low-pass; detune amount is a RATE control, not just a timbre control; the sub is near-universally split out as its own mono sine layer with an 80–150 Hz crossover; mono-below-X is treated as a hard rule
    - *[measured — patch files]* docs/research/141 §5.2 — 1,426 unison stacks, 494 bass patches — median unison detune 16.6 ¢ for bass at ≥5 voices (pooled ≥3-voice median 11.4 ¢, IQR 6.0–20.0); ±7 ¢ sits at p27, ±20 ¢ at p68, ±61 ¢ at p97 — the tutorial range is real but wildly uncentred
    - *[measured — owned refs]* docs/research/131 §7 P1 — gate numbers — sub share, centroid ceiling, mono width, sub-band steadiness

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandSubPct` | 30..78 | computable today | 38.17 | **PASS** |
| `bandBassPct` | 8..50 | computable today | 51.97 | **FAIL** (off by 1.97) |
| `centroidLog2` | 5..6.9 | computable today | 7.16 | **FAIL** (off by 0.26) |
| `stereoWidthDb` | -100..-30 | computable today | -20.97 | **FAIL** (off by 9.03) |
| `crestDb` | 6..16 | computable today | 10.2 | **PASS** |
| `crest_subDb` | 0..12 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `fluxMean` | 0.08..0.4 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §7 P1 (packs-era bassline ref medians) — packs-ref medians widened to the doc's quoted p25–p75 band, as of 2026-07-26.*

### `acid-303` v1

*One saw voice, filter almost shut with high resonance, glide between every note, and an accent that raises volume, cutoff and resonance together — then drive straight after the filter.*

- **tags** — acid, techno, house, 303
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `octave-bounce`, register MIDI 28..36
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 1 / 0.72 / 0.55 by metrical position
    - gate ×0.35
    - glide 0.06s
    - the velocity tiers ARE the accent grammar: `velToFilterAmount` and `velDest: resonance` turn each tier into the simultaneous volume+cutoff+resonance lift the corpus defines an accent as
    - sources quote portamento as 30–50% of the host synth's own knob, never in seconds; 0.06 s is roughly a 16th at 125 BPM and is an unsourced conversion
- **layers** (1)
    - **`acid`** — synth, production role `bass`
        - *why*: one voice, deliberately: the Diva 'Phased Techno Bass' lineage explicitly zeroes oscillators two and three, and every 303 recipe in the corpus is monophonic. Thickness here comes from resonance and drive, not from layering.
        - *patch*: `osc`=sawtooth, `cutoff`=220, `resonance`=9, `attack`=0.002, `decay`=0.25, `sustain`=0.15, `release`=0.03, `filterEnvAmount`=0.7, `filterEnvAttack`=0.002, `filterEnvDecay`=0.18, `filterEnvSustain`=0.05, `filterEnvRelease`=0.05, `velToFilterAmount`=0.6, `velDest`=resonance, `velAmount`=0.35, `unisonVoices`=1, `unisonWidth`=0, `distortionAmount`=0.63, `distortionMix`=0.6, `pingPongTime`=0.28, `pingPongFeedback`=0.37, `pingPongMix`=0.21, `eq7HpOn`=true, `eq7HpFreq`=150, `pan`=0, `volume`=-8
        - *solo gates*: `bandBassPct` 10..70
- **chain** (clip level, in order)
    - `effect-add $acid eq7`
- **sweep dials**
    - **arpGate** (`sustain`) = 0.35, range 0.18..0.47 — the only two hard gate-length numbers in the whole techno-bass vein are ~18% (Sylenth 303 arp) and 47% (Diva acid arp) — a 2.6× spread with nothing between them. The value is the midpoint; `field` names `sustain` only because the recipe's gate is applied to note LENGTH (figure.feel.gate), which has no synth field of its own.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - filter SLOPE is unexpressible and the corpus disagrees about it anyway (Roland: the real TB-303 is 18 dB/oct; MusicRadar: 24; the Sylenth recipe deliberately switches to 12). dotbeat's `filterType` selects lowpass/bandpass/highpass with no slope control, so the disagreement is moot rather than resolved.
    - per-step TIE/SLIDE flags — the defining 303 gesture (Sylenth's own sequence ties steps 3, 4, 5 and 8; MusicRadar activates hold on 'certain steps'). dotbeat's `glide` is a voice-level setting, so EVERY note slides here, not only the flagged ones.
    - odd-length sequencing (13 or 15 steps against a 16-step grid — MusicTech's Chicago-style trick) is not expressible: a .beat figure loops on whole bars.
    - two credentialed sources argue acid should not be captured as a static patch at all (Native Instruments: 'parameter automation over static settings'; Attack Magazine: 'preferably done hands-on in real time'). The v1 step vocabulary has no `automate`, and clip automation renders only in song mode (133 §3) — so the genre's own experts would call this recipe the wrong shape for the sound.
- **sources**
    - *[single source — a hypothesis]* [Roland Articles — Beyond Acid: Pushing the TB-303 into New Sonic Territory](https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory/) — acid basslines start with the cutoff low and open it gradually with resonance high; the accent is explicitly a simultaneous boost of volume AND brightness, not a level-only effect
    - *[single source — a hypothesis]* [Attack Magazine — 303-Style Acid Arpeggiator in Sylenth (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/tb-303-acid-arpeggiator-sylenth/) — the most numerically complete 303 emulation found: pulse osc at octave −2, mono legato with portamento ~50%, a deliberately non-zero amp release 'to prevent clicking', 1/16 step mode at ~18% gate over an 8-step wrap
    - *[single source — a hypothesis]* [Attack Magazine — Acid Synth in u-he Diva (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/acid-synth-uhe-diva/) — mono (not legato) so glide applies to every note, glide set 'one third of the way' up; overdrive at Drive 63% / Tone 60% placed straight after the filter, then a ping-pong delay at Feedback 37% / mix 21%; arpeggiator gate 47%
    - *[single source — a hypothesis]* [MusicRadar — How to make an acid bassline like Fatboy Slim's 303](https://www.musicradar.com/how-to/make-acid-bassline-fatboy-slim-303) — velocity routed to filter cutoff AND resonance, plus a low-depth free-running LFO on cutoff for per-note unpredictability
    - *[consensus (3+ sources)]* docs/priors/bass-techno.md consensus 4, 5, 6 — accent = simultaneous cutoff + resonance + volume boost (4 sources); mono or legato voicing with 30–50% portamento is required for authentic slides (3 sources); the drive stage sits immediately AFTER the filter, before delay/reverb, across nearly every bass recipe in the vein (6 sources)
    - *[single source — a hypothesis]* [Futureproof Music School — How to Make Hard Techno](https://futureproofmusicschool.com/blog/making-hard-techno-a-path-to-unique-sound-design) — high-pass the acid bass around 150 Hz before the master bus so it does not fight the kick's sub territory
    - *[measured — patch files]* docs/research/141 §4 — 494 bass patches — the static cutoff knob is LOW (bass p25–p75 76–732 Hz) and resonance is bimodal — p25 is exactly 0.00 in five of six roles while p75 is 0.4–0.66, so the design decision is WHETHER to resonate, and acid is the archetypal 'yes'

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandSubPct` | 5..55 | computable today | 0.03 | **FAIL** (off by 4.97) |
| `bandBassPct` | 10..60 | computable today | 54.7 | **PASS** |
| `bandMidsPct` | 10..70 | computable today | 44.2 | **PASS** |
| `centroidLog2` | 5.5..8.5 | computable today | 8.99 | **FAIL** (off by 0.49) |
| `crestDb` | 8..17 | computable today | 23.27 | **FAIL** (off by 6.27) |
| `stereoWidthDb` | -100..-18 | computable today | -17.26 | **FAIL** (off by 0.74) |

*Gates mined from docs/research/131 §7 P1 widened for a mid-forward acid voice (this recipe deliberately does NOT chase the 30% sub share — the corpus high-passes the acid line at 150 Hz to protect the kick) — packs-ref bassline bands, sub floor relaxed to match the source's own EQ instruction, as of 2026-07-26.*

### `808-glide-bass` v1

*A long-decay mono sine with portamento between notes, plus a saturated octave-up body layer high-passed at 200 Hz so the sub stays clean under the drive.*

- **tags** — trap, hip-hop, footwork, 808
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `sparse-sub`, register MIDI 28..33
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.8 / 0.65 by metrical position
    - gate ×1.15
    - glide 0.1s
    - gate > 1 deliberately overlaps consecutive notes, because every source triggers the 808 slide by OVERLAPPING MIDI notes rather than by a per-note flag
    - Production Music Live's workflow is to copy the kick's MIDI pattern onto the bass and repitch it; the composed figure here is an independent bassline, which is a real divergence from trap practice
- **layers** (2)
    - **`sub-808`** — synth, production role `sub`
        - *why*: Unison's 20–80 Hz layer verbatim: pure sine, mono, untouched by processing, high-passed only at 22 Hz to strip subsonic mud. The long decay with zero sustain is the 808's amplitude signature.
        - *patch*: `osc`=sine, `attack`=0.004, `decay`=0.6, `sustain`=0, `release`=0.4, `cutoff`=200, `resonance`=0.1, `filterEnvAmount`=0, `unisonVoices`=1, `unisonWidth`=0, `chorusMix`=0, `sendReverb`=0, `eq7HpOn`=true, `eq7HpFreq`=22, `pan`=0, `volume`=-5
        - *solo gates*: `bandSubPct` 45..100, `stereoWidthDb` -100..-35
    - **`body`** — synth, +12 semitones, production role `bass`
        - *why*: Unison's 80–300 Hz mid-body: the sub duplicated an octave up, detuned −7 ¢ 'for analog movement', high-passed at 200 Hz and lightly saturated with a +2 dB harmonic-texture bell at 1 kHz — the band that makes an 808 audible on a phone speaker.
        - *patch*: `osc`=sine, `osc2Type`=triangle, `osc2Level`=0.4, `osc2Detune`=-7, `cutoff`=900, `resonance`=0.3, `attack`=0.004, `decay`=0.6, `sustain`=0, `release`=0.4, `filterEnvAmount`=0, `unisonVoices`=1, `unisonWidth`=0, `saturatorCurve`=warm, `saturatorDrive`=0.3, `saturatorMix`=0.4, `eq7HpOn`=true, `eq7HpFreq`=200, `eq7Bell1On`=true, `eq7Bell1Freq`=1000, `eq7Bell1Gain`=2, `eq7Bell1Q`=1, `pan`=0, `volume`=-13
        - *solo gates*: `bandSubPct` 0..30, `bandBassPct` 12..75
- **chain** (clip level, in order)
    - `effect-add $sub-808 eq7`
    - `effect-add $body eq7`
- **sweep dials**
    - **glideSeconds** (`glide`) = 0.1, range 0.08..0.3 — 808 glide time varies 3–4× with no source reconciling it: 80–120 ms ('smooth slides', Unison), ~300 ms (Attack's Serum patch), 'halfway on the dial' (two others, unconvertible). No patch corpus measures portamento. 0.10 s is the low, numerically-stated end; the range is the full stated span.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - THE 808's DEFINING MOVE IS NOT EXPRESSIBLE: every source specifies a downward PITCH ENVELOPE at note-on (Unison: 24 semitones over 40–60 ms, exponential; Attack: 'a decaying pitch drop'). dotbeat has no pitch envelope — `lfoDest: 'pitch'` is a cyclic LFO, not a one-shot decay — so this recipe ships the sine, the glide and the long decay WITHOUT the dive. That is an audible, identity-level difference from every 808 in the corpus, and it is the single strongest engine-gap finding in this library.
    - multiband saturation split at 123 Hz (Attack) — full-band saturator only; the sub/body layer split is the layered approximation.
    - the −7 ¢ octave-up detune rides on `osc2`, which shares the layer's filter and envelope; Unison's version is a separate voice with its own processing.
    - the click/transient layer (1–5 kHz, a filtered rimshot under 50 ms) is a SAMPLE in every source; expressing it needs a drums-kind sample host, which is a cross-source stack (139 §3.4 tier 3), not a synth layer.
- **sources**
    - *[single source — a hypothesis]* [Unison Audio — Best 808 Sound Design Tricks, Techniques & Secrets](https://unison.audio/808-sound-design/) — the most numerically complete 808 recipe found: sine at 40–60 Hz fundamental, an octave-up duplicate detuned −7 ¢; glide 80–120 ms via overlapping MIDI notes; amp attack 0–5 ms, decay 550–650 ms, sustain 0, release 400 ms; high-pass 20–22 Hz; layer split sub 20–80 Hz (pure sine, mono, untouched) / mid-body 80–300 Hz (octave up, high-passed at 200 Hz, slight distortion) / click 1–5 kHz; mono below 150–200 Hz minimum
    - *[single source — a hypothesis]* [Attack Magazine — 808 Bass with Saturation (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/808-bass-with-saturation/) — mono with portamento at ~300 ms glide; multiband saturation split explicitly at 123 Hz with the lower band's drive significantly reduced 'to protect the sub'; an internal high-pass inside the distortion so sub frequencies are not distorted away
    - *[single source — a hypothesis]* [Attack Magazine — Creating 808-Style Basslines for Jungle, Trap and Footwork](https://www.attackmagazine.com/technique/tutorials/creating-808-style-basslines-for-jungle-trap-and-footwork/) — carve the bass below 200 Hz to prevent sub-vs-body conflicts; a four-stage sequential distortion chain (drive → shaper → lo-fi → tape)
    - *[consensus (3+ sources)]* docs/priors/bass-basseries.md consensus 6 — 808 design consistently uses a sine oscillator, a downward pitch envelope at note-on, glide/portamento between notes, and post-distortion EQ to carve space against the kick
    - *[measured — patch files]* docs/research/141 §3.1/§3.2 — bass row — bass amp attack median 3.91 ms with 83% ≤12.5 ms; the long DECAY is the shaping stage (median 621 ms, IQR 250–1080) — which matches Unison's 550–650 ms exactly and contradicts nothing

**Clip gates** (checked on the summed render) — last verified run: **INCOMPLETE**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandSubPct` | 30..85 | computable today | 81.2 | **PASS** |
| `bandBassPct` | 5..45 | computable today | 18.35 | **PASS** |
| `centroidLog2` | 4.8..6.6 | computable today | 5.81 | **PASS** |
| `stereoWidthDb` | -100..-35 | computable today | -66.73 | **PASS** |
| `crestDb` | 7..18 | computable today | 16.57 | **PASS** |
| `crest_subDb` | 0..14 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §7 P1 (packs bassline ref medians), sub band widened to 85% for a role whose whole point is sub dominance — packs-ref medians, p25–p75, as of 2026-07-26.*

### `three-layer-bass-stack` v1

*The corpus's single best-documented layer architecture, built as three real tracks: mono sine sub, band-limited body, and a detuned growl layer with the metallic 1.6–3.8 kHz notch and the 450–800 Hz warmth boost.*

- **tags** — layered, techno, dnb, architecture
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `rolling-8ths`, register MIDI 28..33
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.92 / 0.76 / 0.6 by metrical position
    - gate ×0.8
    - **rest on every beat-1 16th** (kick clearance)
    - all three layers share ONE figure and ONE LFO rate (1/1-synced cutoff on both processed layers) — ProducerHive's modulation-coherence rule, which is the difference between a stack and three basses playing at once
- **layers** (3)
    - **`sub`** — synth, production role `sub`
        - *why*: 0–100 Hz, 'rumble and energy, felt more than heard': a pure mono sine low-passed at ProducerHive's 90–100 Hz, deliberately carrying NO saturation, NO reverb and NO LFO — the protected signal path.
        - *patch*: `osc`=sine, `attack`=0.004, `decay`=0.3, `sustain`=0.95, `release`=0.03, `cutoff`=95, `resonance`=0.1, `filterEnvAmount`=0, `unisonVoices`=1, `unisonWidth`=0, `chorusMix`=0, `sendReverb`=0, `saturatorMix`=0, `pan`=0, `volume`=-3
        - *solo gates*: `bandSubPct` 50..100, `stereoWidthDb` -100..-35
    - **`body`** — synth, +12 semitones, production role `bass`
        - *why*: 100–500 Hz, 'power, body, warmth — keeps the sound from going hollow on small speakers': saw+square bracketed by a 100 Hz high-pass (MusicRadar's 79 Hz, ProducerHive's 'just above 100') and a 500 Hz low-pass, warmly saturated, sharing the growl layer's LFO exactly.
        - *patch*: `osc`=sawtooth, `osc2Type`=square, `osc2Level`=0.4, `osc2Detune`=8, `cutoff`=480, `resonance`=0.8, `attack`=0.004, `decay`=0.2, `sustain`=0.5, `release`=0.03, `filterEnvAmount`=0.4, `filterEnvDecay`=0.15, `filterEnvSustain`=0.1, `unisonVoices`=1, `unisonWidth`=0, `lfoDest`=cutoff, `lfoSync`=true, `lfoSyncRate`=1/1, `lfoDepth`=0.25, `saturatorCurve`=warm, `saturatorDrive`=0.3, `saturatorMix`=0.3, `eq7HpOn`=true, `eq7HpFreq`=100, `eq7LpOn`=true, `eq7LpFreq`=500, `pan`=0, `volume`=-9
        - *solo gates*: `bandBassPct` 20..85, `bandSubPct` 0..25
    - **`growl`** — synth, +24 semitones, production role `bass`
        - *why*: 500–2000 Hz, 'the main characteristics of the stack' — the character layer: detuned saws distorted, high-passed at 500 Hz, carrying KVR's exact de-harshing pair (a high-Q −8 dB notch at 2.5 kHz and a wide +3 dB boost at 600 Hz), on the same LFO as the body.
        - *patch*: `osc`=sawtooth, `osc2Type`=sawtooth, `osc2Level`=0.7, `osc2Detune`=17, `unisonVoices`=3, `unisonWidth`=0.45, `cutoff`=1800, `resonance`=1.5, `attack`=0.004, `decay`=0.18, `sustain`=0.4, `release`=0.03, `filterEnvAmount`=0.5, `filterEnvDecay`=0.14, `filterEnvSustain`=0.1, `lfoDest`=cutoff, `lfoSync`=true, `lfoSyncRate`=1/1, `lfoDepth`=0.25, `distortionAmount`=0.3, `distortionMix`=0.35, `eq7HpOn`=true, `eq7HpFreq`=500, `eq7Bell1On`=true, `eq7Bell1Freq`=2500, `eq7Bell1Gain`=-8, `eq7Bell1Q`=4, `eq7Bell2On`=true, `eq7Bell2Freq`=600, `eq7Bell2Gain`=3, `eq7Bell2Q`=0.7, `volume`=-13
        - *solo gates*: `bandSubPct` 0..15, `bandPresencePct` 0.5..70
- **chain** (clip level, in order)
    - `track-add pump` (drums, kick-quarters, -60 dB)
    - `effect-add $body eq7`
    - `effect-add $growl eq7`
    - `set $body.duckSource pump`
    - `set $body.duckAmount 0.35`
    - `set $growl.duckSource pump`
    - `set $growl.duckAmount 0.35`
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - ProducerHive's central routing instruction — bus everything except the sub and glue-compress that bus — needs a group bus, which BeatGroup is not (research 115 §1.2). The two-stage re-host (133 §4d) can do it in a second render pass; this single-pass recipe cannot.
    - the corpus's fourth 'highs/air' layer above 2 kHz is omitted deliberately: at 2 kHz+ over a bass fundamental it is a texture source, and the same three sources that name it give no numbers for it. Adding a fourth layer would be exactly the 'seven fighting for space' failure §6 warns about.
    - the light glue compression the corpus specifies (3–6 dB gain reduction across the stack — ModeAudio, corroborated) is applied per-layer here, which is a different sound from bus compression on the sum.
- **sources**
    - *[consensus (3+ sources)]* docs/priors/layering.md §1 — four independent sources (Subaqueous, ProducerHive, MusicRadar, Samplesound) — the best-documented architecture in the whole layering vein: sub 0–100 Hz ('rumble and energy', felt more than heard), low/mid 100–500 Hz ('power', body, keeps the sound from going hollow on small speakers), high/growl 500–2000 Hz ('main characteristics of the stack', usually saturated), highs 2000 Hz+ ('presence and sheen')
    - *[single source — a hypothesis]* [ProducerHive — How to layer bass synths](https://producerhive.com/music-production-recording-tips/how-to-layer-bass-synths/) — sub low-passed to 90–100 Hz; low-mid high-passed just above 100 Hz and low-passed 400–500 Hz; highs high-passed below 2000 Hz. Signal-chain rule: group everything EXCEPT the sub under one bus and leave the sub layer unprocessed and unrouted — a separate, protected signal path. Modulation rule: all layers must share identical LFO shape and rate or the stack stops reading as one object
    - *[single source — a hypothesis]* [MusicRadar — 6 steps to creating a perfect layered bass sound](https://www.musicradar.com/tuition/tech/6-steps-to-creating-a-perfect-layered-bass-sound-639120) — a 24 dB/oct high-pass at 79 Hz (Q 0.7) on the mid layer 'to roll off the sub frequencies already present in the bass to avoid any clashes'; worked fader values of −3 dB for the sub and −10 dB for the supporting transient layer
    - *[single source — a hypothesis]* [KVR Audio — detuned-saw stack EQ thread](https://www.kvraudio.com/forum/viewtopic.php?t=377166) — the specific EQ move for removing metallic harshness from a stack of detuned saws: cut 1.6–3.8 kHz by 6–12 dB with a high-Q notch, then add a wide boost at 450–800 Hz for 'warmth without narrowness'
    - *[consensus (3+ sources)]* docs/priors/layering.md §6 — cross-source consensus — the clearest agreement in the whole vein is a WARNING: 'only layer when there is a good reason for doing so'; 'poor layering occurs when multiple sounds try to do the same thing'; 'three well-crafted layers usually sound better than seven fighting for space'. Hence every layer here states its job, and there are three, not seven
    - *[measured — owned refs]* docs/research/131 §3.2 + §5 (bassline row) — gate numbers, and the reason this shape exists: even ELITE engineplus bass keeps 2× the sub-band crest (22.6 vs 10.9 dB), half the spectral movement (fluxMean 0.09 vs 0.20) and is 30 dB wider than the dead-mono elite refs — properties of a stack, not of any single patch

**Clip gates** (checked on the summed render) — last verified run: **INCOMPLETE**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandSubPct` | 30..78 | computable today | 64.39 | **PASS** |
| `bandBassPct` | 8..50 | computable today | 32.07 | **PASS** |
| `bandMidsPct` | 2..40 | computable today | 3.48 | **PASS** |
| `centroidLog2` | 5..7.2 | computable today | 6.39 | **PASS** |
| `stereoWidthDb` | -100..-25 | computable today | -37.7 | **PASS** |
| `crestDb` | 6..16 | computable today | 15.1 | **PASS** |
| `crest_subDb` | 0..12 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `fluxMean` | 0.08..0.4 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §5 (top-5 elite ref bassline rows) + §7 P1 — elite-ref medians widened to the packs p25–p75 band, as of 2026-07-26.*


## Chords — punch, pace and body (research 131 §7 P2/P3; ref chords fire 4.9 onsets/s against engineplus 2.3)

### `warm-pad-with-air` v1

*A slow-blooming detuned pad under a quieter, high-passed noise-and-triangle air layer, with a whole-note filter LFO for breathing and parallel compression for density.*

- **tags** — house, deep-house, ambient, warm
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `sustained-pad`, register MIDI 48..62
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.78 / 0.68 / 0.58 by metrical position
    - gate ×1
    - pads are the one role where 131 does NOT want a fast attack — 141 measured pads as a separate distribution, so this recipe's attack gate is 200–1400 ms and every transient-role rule is deliberately inverted
- **layers** (2)
    - **`pad`** — synth, production role `pad`
        - *why*: the harmonic bed: saw + triangle detuned by the measured pad median, five unison voices, a slow filter bloom, and a 1/1-synced cutoff LFO for the 'breathing' the movement gates ask for.
        - *patch*: `osc`=sawtooth, `osc2Type`=triangle, `osc2Level`=0.6, `osc2Detune`=18, `unisonVoices`=5, `unisonWidth`=0.7, `cutoff`=2200, `resonance`=0.6, `attack`=0.54, `decay`=0.8, `sustain`=0.9, `release`=1.8, `filterEnvAmount`=0.25, `filterEnvAttack`=0.6, `filterEnvDecay`=1.2, `filterEnvSustain`=0.5, `lfoDest`=cutoff, `lfoSync`=true, `lfoSyncRate`=1/1, `lfoDepth`=0.3, `volume`=-8
        - *produce*: `{"chorusMix":0.25,"sendReverb":0.3,"utilityWidth":0.62}`
        - *solo gates*: `stereoWidthDb` -16..-1, `bandMidsPct` 30..95
    - **`air`** — synth, +12 semitones, production role `pad`
        - *why*: the sheen layer: a quiet triangle carrying filtered noise, high-passed at 2 kHz so it adds presence-band texture without thickening the low-mids — 131 P4's texture axis, which no amount of EQ on the pad alone can create ('EQ can't boost something that isn't there in the first place').
        - *patch*: `osc`=triangle, `noiseLevel`=0.12, `cutoff`=9000, `resonance`=0.2, `attack`=0.7, `decay`=1, `sustain`=0.7, `release`=2, `filterEnvAmount`=0, `unisonVoices`=3, `unisonWidth`=0.8, `eq7HpOn`=true, `eq7HpFreq`=2000, `sendReverb`=0.25, `volume`=-18
        - *solo gates*: `bandPresencePct` 2..70, `bandAirPct` 0.5..70
- **chain** (clip level, in order)
    - `effect-add $air eq7`
    - `set $pad.compThreshold -32`
    - `set $pad.compRatio 8`
    - `set $pad.compAttack 0.004`
    - `set $pad.compRelease 0.12`
    - `set $pad.compMix 0.35`
- **sweep dials**
    - **padDetuneCents** (`osc2Detune`) = 18, range 3..40 — the corpus's second-loudest disagreement, and it is about MEANING as much as magnitude: Attack's Zebra pad uses 3–4 ¢ deliberately 'for warmth', while Sound on Sound explicitly frames wider detune as a DEFECT ('weird off-colour timbre') and trance sources chase 7.5 ¢+ per oscillator as a FEATURE. research 141 measured 149 pad patches at ≥5 voices: median 17.7 ¢, i.e. designers sit far above the 'warmth' end. 18 is encoded; the range spans the sub-4 ¢ warmth reading through CMUSE's 18–40 ¢ 'pad/string wash' band.
    - **padAttackSeconds** (`attack`) = 0.54, range 0.07..3 — prose says 1 s ('slow bloom', trance supersaw pad) to 3 s (Attack's Detuned Pad). research 141's 406 pad patches: median 540.6 ms, IQR 70–1,405 ms — so the tutorials quote the upper half. The patch-file median is encoded; the range spans the measured IQR through the prose maximum.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - the per-chord EXPRESSION SWELL (an automated CC ramp from ~50% to maximum into every chord change) appears independently in two Attack Magazine pad recipes and is the corpus's main source of pad movement. It needs clip automation, which renders only in song mode (133 §3) and has no v1 recipe step.
    - sample-and-hold random pitch drift (Sound on Sound's string-machine mechanism, chosen specifically to avoid periodic modulation) — `lfoShape` offers sine or custom, with no S&H/random option.
    - reverb PRE-DELAY is named in three pad recipes; dotbeat's reverb is a fixed shared bus with a send level and no predelay control (research 139 §2.3's named gap).
    - Kerri Chandler's root-omission rule ('the keys are not playing the root note, because the bass line has the roots covered') is a VOICING requirement the composed-figure generator does not implement.
- **sources**
    - *[single source — a hypothesis]* [Attack Magazine — Detuned Pad (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/detuned-pad/) — 5-voice sine oscillator an octave down at 4.05 ¢ detune plus a 7-voice saw at 3 ¢, amp attack 3 s / release 7 s, chorus (16 ms, 0.22 Hz, 50% depth, 60% mix) then reverb (size 6.0, 0 ms predelay, 30% mix) — chorus before reverb
    - *[single source — a hypothesis]* [Sound on Sound — Synthesizing Strings: String Machines (Synth Secrets)](https://www.soundonsound.com/techniques/synthesizing-strings-string-machines) — detune between the two oscillators kept MINIMAL, with an explicit warning that more detune causes a 'weird off-colour timbre'; random (sample-and-hold) pitch drift rather than periodic vibrato; a trapezoid VCA contour
    - *[consensus (3+ sources)]* docs/priors/chords-pads.md consensus 2, 4, 5 — pad attack times run 1–3 orders of magnitude longer than stab attacks and several sources tie the attack explicitly to character; chorus-then-reverb is the default pad finishing chain across five recipes; dual-oscillator construction with opposite-direction detune is close to universal
    - *[measured — patch files]* docs/research/141 §3.1/§5.2/§8 — 406–419 pad patches — pads are a DIFFERENT distribution, not a slow tail of the transient one: amp attack median 540.6 ms (IQR 70–1405), only 16.7% ≤12.5 ms and 71.4% >100 ms; release median 1,803 ms (IQR 611–3,000); sustain 0.68–1.0; ≥2 oscillators in 57%; unison detune median 17.7 ¢ at ≥5 voices
    - *[measured — owned refs]* docs/research/131 §5 + §7 P5, 133 §1 — gate numbers — chords carry 18–28% bass-band body against engineplus's ~0, crest 14–17 dB, role-true width ≈ −3…−8 dB, fluxMean ≥0.12
    - *[measured — owned refs]* docs/research/138 §2 free win 4 — compMix ships at 0 and is untouched by every profile and trick — the comp insert is a real dry/wet parallel fan sitting unused; −32 dB threshold, 8:1, ≤5 ms attack, 0.12 s release, 0.3–0.4 mix

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandBassPct` | 8..42 | computable today | 74.7 | **FAIL** (off by 32.7) |
| `bandMidsPct` | 40..85 | computable today | 24.94 | **FAIL** (off by 15.06) |
| `bandPresencePct` | 1..20 | computable today | 0.32 | **FAIL** (off by 0.68) |
| `bandAirPct` | 0.3..9 | computable today | 0.04 | **FAIL** (off by 0.26) |
| `crestDb` | 9..19 | computable today | 14.16 | **PASS** |
| `stereoWidthDb` | -16..-1 | computable today | -7.62 | **PASS** |
| `fluxMean` | 0.1..0.4 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `attackMedMs` | 200..1400 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §5/§7 P5 + 133 §1 (packs chords ref rows); the attackMedMs band is 141 §3.1's pad IQR, NOT 131's transient-role target — packs-ref chords medians (p25–p75) for the spectral/width/crest rows; Surge pad-patch IQR for the attack row, as of 2026-07-26.*

### `house-chord-stab` v1

*A zero-attack, zero-sustain stab whose whole shape is filter-envelope decay, doubled by a quiet octave-down body layer — the octave split 78.6% of Surge's own Chords patches actually use.*

- **tags** — house, deep-house, stab, octave-split
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `offbeat-house`, register MIDI 55..72
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - swing **56%** (grid 1)
    - velocity tiers 0.92 / 0.72 / 0.56 by metrical position
    - gate ×0.45
    - the 56% swing is a light house shuffle inside SampleFocus's 52–70% usable range; no chords source quotes a swing number, so it is taken from the drum vein's own band
- **layers** (2)
    - **`stab`** — synth, production role `chords`
        - *why*: the stab itself: envelope times taken from Surge's own Chords category rather than from prose (attack 5 ms, decay 250 ms, release 31 ms, sustain 0), with the filter envelope doing all the shaping at the corpus's ~19-semitone envmod depth.
        - *patch*: `osc`=sawtooth, `osc2Type`=sawtooth, `osc2Level`=0.5, `osc2Detune`=10, `unisonVoices`=3, `unisonWidth`=0.55, `cutoff`=320, `resonance`=1.8, `attack`=0.005, `decay`=0.25, `sustain`=0, `release`=0.031, `filterEnvAmount`=0.8, `filterEnvAttack`=0.003, `filterEnvDecay`=0.16, `filterEnvSustain`=0, `filterEnvRelease`=0.05, `velToFilterAmount`=0.35, `saturatorCurve`=warm, `saturatorDrive`=0.2, `saturatorMix`=0.25, `volume`=-7
        - *solo gates*: `bandMidsPct` 25..92
    - **`body`** — synth, -12 semitones, production role `chords`
        - *why*: the octave-down body — the single most common layering form in the whole patch corpus (78.6% of Chords patches are octave-split) and 138's free win 3, aimed squarely at engineplus's measured 99% mids occupancy.
        - *patch*: `osc`=sawtooth, `osc2Level`=0, `unisonVoices`=1, `unisonWidth`=0, `cutoff`=800, `resonance`=0.5, `attack`=0.005, `decay`=0.25, `sustain`=0, `release`=0.031, `filterEnvAmount`=0.4, `filterEnvDecay`=0.16, `filterEnvSustain`=0, `pan`=0, `volume`=-14
        - *solo gates*: `bandBassPct` 8..80, `bandSubPct` 0..30
- **chain** (clip level, in order)
    - `set $stab.sendReverb 0.18`
    - `set $stab.sendDelay 0.12`
    - `set $stab.compThreshold -30`
    - `set $stab.compRatio 8`
    - `set $stab.compAttack 0.004`
    - `set $stab.compRelease 0.1`
    - `set $stab.compMix 0.35`
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - Kerri Chandler's two load-bearing voicing rules — 3rd-inversion 7th chords, and omitting the root entirely because the bassline covers it — are figure-level requirements the composed-phrase generator does not implement. Multiple sources call voicing MORE decisive than any synthesis parameter for this genre's identity.
    - 'the chord part deliberately leaves out beats occupied by the main drum hits' — a rhythmic complement to the kit that a role-solo clip has no kit to complement.
    - the 'chord baked into oscillator tuning' architecture (0/+3/+7 semitone oscillators, so one key plays a triad) is not expressible: `osc2Detune` is a cents field the GUI narrows to ±100, and there is no third oscillator.
- **sources**
    - *[single source — a hypothesis]* [KVR Audio — 'How to make this deep house stabs' (practitioner MOK19), corroborated by the Sytrus and Attack house-chord walkthroughs](https://www.kvraudio.com/forum/viewtopic.php?t=327685) — lowpass cutoff medium-low at ~250–350 Hz; filter envelope with sustain 0 and a short decay, and the explicit framing that this decay length 'is primarily what makes a patch a stab' — more decisive than the exact cutoff
    - *[single source — a hypothesis]* [Attack Magazine — Old-School House Chords (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/old-school-house-chords/) — cutoff turned down toward 0 and driven almost entirely by envelope modulation; 'a fairly swift attack and longer decay'; unison pushed from 2 to 7 voices with 'subtle detuning applied for warmth'; reverb then a stereo widener
    - *[consensus (3+ sources)]* docs/priors/chords-pads.md consensus 1 and 8 — the stab envelope shape is universal — fast/zero attack, genuinely short decay, near-zero sustain — and stab/pluck amp-envelope attack is CONSENSUS-ZERO, not 'short but nonzero'; nothing in the corpus supports a 10–30 ms attack for a stab (the only real ~30 ms figure anywhere is a compressor attack)
    - *[measured — patch files]* docs/research/141 §3.1/§5.3/§7.3 — Surge's own Chords category, n=28 — amp attack median 4.83 ms with 85.7% ≤12.5 ms, release median 31 ms, decay median 250 ms; 85.7% multi-oscillator and 78.6% OCTAVE-SPLIT with half carrying a layer a full octave or more below the top; filter envmod median 19.5 semitones. Our chords arm maps to ['Pads','Keys'] and never draws from this shelf at all
    - *[measured — owned refs]* docs/research/131 §2.2 + §5 — on chords, FAST attacks win (attackP25Ms P(win|hi) 0.361, d −0.51) and pace discriminates hard (ref onset rate 4.9/s vs engineplus 2.3); elite refs' chords sit 1.4 octaves darker than the engine's
    - *[measured — owned refs]* docs/research/138 §2 free win 3 — the octave BODY layer (osc2Detune −1200, level 0.3–0.4) against engineplus's +10-cent width move; target chords bass-band 18–28% versus a measured 99% mids occupancy

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandBassPct` | 10..42 | computable today | 8.28 | **FAIL** (off by 1.72) |
| `bandMidsPct` | 40..85 | computable today | 89.27 | **FAIL** (off by 4.27) |
| `crestDb` | 11..20 | computable today | 19.62 | **PASS** |
| `stereoWidthDb` | -16..-1 | computable today | -21.59 | **FAIL** (off by 5.59) |
| `attackMedMs` | 0..12 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `onsetRatePerSec` | 4..12 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §7 P2/P3/P5 + 133 §1 (packs chords ref rows) — packs-ref medians as p25–p75 bands; attackMedMs and onsetRatePerSec are 131 P2/P3's explicit chords targets, as of 2026-07-26.*

### `techno-stab` v1

*The one recipe in the whole chords vein with a complete millisecond envelope pair: square wave, amp A0/D66/S0/R29 ms, filter A5/D48/S0.09/R24 ms, soft-clipped and ping-ponged.*

- **tags** — techno, stab, dark, percussive
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `half-bar-hits`, register MIDI 48..64
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.72 / 0.52 by metrical position
    - gate ×0.35
    - no swing: techno stabs in this lineage sit on the grid, and the source quotes no swing figure
- **layers** (1)
    - **`stab`** — synth, production role `chords`
        - *why*: a single square voice — the source specifies no second oscillator, and in this lineage the stab is frequently mono-note; the character comes from the resonant, envelope-slammed filter and the drive stack after it, not from layering.
        - *patch*: `osc`=square, `osc2Type`=square, `osc2Level`=0.4, `osc2Detune`=12, `unisonVoices`=3, `unisonWidth`=0.45, `cutoff`=400, `resonance`=3, `attack`=0.001, `decay`=0.066, `sustain`=0, `release`=0.029, `filterEnvAmount`=0.75, `filterEnvAttack`=0.005, `filterEnvDecay`=0.048, `filterEnvSustain`=0.09, `filterEnvRelease`=0.024, `distortionAmount`=0.13, `distortionMix`=0.13, `saturatorCurve`=clip, `saturatorDrive`=0.35, `saturatorMix`=0.3, `pingPongTime`=0.19, `pingPongFeedback`=0.3, `pingPongMix`=0.22, `sendReverb`=0.18, `volume`=-7
        - *solo gates*: `bandMidsPct` 25..92
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - the source places REVERB FIRST in the DAW chain, ahead of the drive stages, deliberately. dotbeat's reverb is a shared return bus fed after the insert chain, so reverb-before-drive is not expressible at any order.
    - 'Drum Buss at 26% drive' used as a bus saturator on a melodic part has no equivalent node; the saturator insert is the nearest move.
    - the source automates mod-envelope attack/decay and reverb wet on the FINAL note of the phrase as a deliberate phrase-ending device — per-note parameter automation is not in the step vocabulary.
- **sources**
    - *[single source — a hypothesis]* [Attack Magazine — Techno Synth Stabs (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/techno-synth-stabs/) — the only source in the vein giving both envelopes in real milliseconds — amp Attack 0 / Decay 66.00 / Sustain 0 / Release 29.00 ms and filter mod-env Attack 5.00 / Decay 48.00 / Sustain 9.00 / Release 24.00 ms — over a square wave with a low, resonant lowpass at mod-env-to-cutoff '3 o'clock'; then Soft Clip distortion, ping-pong delay with mix and width up, and a DAW chain of reverb → overdrive 13% → saturator (10 dB drive) → drum buss 26%
    - *[consensus (3+ sources)]* docs/priors/chords-pads.md consensus 1 and 8 — fast/zero attack with near-zero sustain is universal across every stab recipe; the perceived punch lives entirely in decay/release length
    - *[measured — patch files]* docs/research/141 §3.1 — chords/polysynth rows — attack median 3.91–4.83 ms with 85.7% ≤12.5 ms and release median 31 ms — the patch corpus corroborates the source's 0 ms attack and 29 ms release almost exactly, which is why this recipe encodes the prose values unchanged
    - *[measured — owned refs]* docs/research/131 §2.2 — gate numbers — on chords, aesPC (0.835/+0.91), fast attacks and true-peak punch are the discriminators; dense low-mids (flatnessLoDb 0.708) beat pure ones

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandMidsPct` | 35..92 | computable today | 27.14 | **FAIL** (off by 7.86) |
| `bandPresencePct` | 1..30 | computable today | 0.91 | **FAIL** (off by 0.09) |
| `crestDb` | 11..21 | computable today | 22.8 | **FAIL** (off by 1.8) |
| `stereoWidthDb` | -18..-1 | computable today | -16.3 | **PASS** |
| `attackMedMs` | 0..12 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §2.2 + §7 P2 (packs chords ref rows) — packs-ref medians as p25–p75 bands, as of 2026-07-26.*


## Lead — texture and role-true width (research 131 §7 P4/P5; elite refs are wide and noisy in presence)

### `supersaw-trance-lead` v1

*Seven detuned saws high-passed at 200 Hz with a presence bump, plus a quieter octave-up layer high-passed at 500 Hz and shelved above 9 kHz — the corpus's most-quantified second layer.*

- **tags** — trance, uplifting, euphoric, supersaw
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `arp-16ths`, register MIDI 64..81
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.8 / 0.65 by metrical position
    - gate ×0.9
- **layers** (2)
    - **`saws`** — synth, production role `lead`
        - *why*: the main wall: seven unison saws plus a detuned second oscillator at the measured lead median, high-passed at 200 Hz with a +2 dB presence bump at 3 kHz, and — the finding that most contradicts our own bank — a 31 ms amp release, because the tail belongs to the sends, not the envelope.
        - *patch*: `osc`=sawtooth, `osc2Type`=sawtooth, `osc2Level`=0.65, `osc2Detune`=10, `unisonVoices`=7, `unisonWidth`=0.85, `cutoff`=9000, `resonance`=0.5, `attack`=0.004, `decay`=0.25, `sustain`=0.6, `release`=0.031, `filterEnvAmount`=0.3, `filterEnvAttack`=0.002, `filterEnvDecay`=0.2, `filterEnvSustain`=0.5, `velToFilterAmount`=0.35, `eq7HpOn`=true, `eq7HpFreq`=200, `eq7Bell1On`=true, `eq7Bell1Freq`=3000, `eq7Bell1Gain`=2, `eq7Bell1Q`=0.8, `saturatorCurve`=analog, `saturatorDrive`=0.25, `saturatorMix`=0.3, `sendReverb`=0.18, `sendDelay`=0.14, `volume`=-6
        - *solo gates*: `stereoWidthDb` -14..-1, `bandMidsPct` 25..92
    - **`octave`** — synth, +12 semitones, production role `lead`
        - *why*: Myloops's octave-up layer verbatim: +12 semitones, four voices with tighter detune, high-passed at 500 Hz and shelved above 9 kHz, sitting 8 dB under the main — the air/width reinforcement that adds upper harmonics without low-mid mass.
        - *patch*: `osc`=sawtooth, `osc2Level`=0, `unisonVoices`=4, `unisonWidth`=0.5, `cutoff`=12000, `resonance`=0.3, `attack`=0.004, `decay`=0.25, `sustain`=0.6, `release`=0.031, `filterEnvAmount`=0, `eq7HpOn`=true, `eq7HpFreq`=500, `eq7HighShelfOn`=true, `eq7HighShelfFreq`=9000, `eq7HighShelfGain`=2.5, `sendReverb`=0.12, `volume`=-14
        - *solo gates*: `bandPresencePct` 2..70, `bandBassPct` 0..25
- **chain** (clip level, in order)
    - `effect-add $saws eq7`
    - `effect-add $octave eq7`
- **sweep dials**
    - **supersawDetuneCents** (`osc2Detune`) = 10, range 7..28 — tutorials cluster at 12–28 ¢ (CMUSE's 'supersaw/shimmer' row) and FaderPro's 20% plugin default; Syntorial refuses a number entirely. research 141 measured 132 lead patches at ≥5 voices: median 10.0 ¢ — leads run the NARROWEST detune of the big roles, the exact opposite of the 'detune the lead hard' folk rule. 10 is encoded.
    - **unisonVoices** (`unisonVoices`) = 7, range 3..7 — 7 is both the JP-8000 hardware count and a real spike in the 1,450-patch histogram (126 patches, third-largest after 2 and 3). Syntorial's '9 per oscillator × 3 oscillators ≈ 27' is a STACKING METHOD, not a voice count, and dotbeat's `unisonVoices` knob maxes at 7 — so the higher tutorial numbers are unreachable, not rejected.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - Syntorial's noise layer is a white-noise OSCILLATOR pitched up four octaves with its own unison and its own high-pass. dotbeat's `noiseLevel` is an unpitched noise mix into the layer's own filter — see `layered-lead-stack` for the three-track form that gets closer.
    - the lead-bus sidechain (2–3 dB gain reduction per kick, ratio 2:1–3:1, attack 5–10 ms, release 100–150 ms — Myloops's only fully-numbered mix move) needs a ghost-kick track and would duck both layers; omitted so the recipe's only variable is the stack.
    - the corpus's 24-bar filter-automation timeline (cutoff creeping open bar by bar, landing fully open on the drop) is arrangement-scale automation — clip automation renders only in song mode and is not a v1 step.
    - band-limiting the reverb SEND (HPF 500 Hz / LPF 8 kHz on the send input, an independently-repeated move in three lead sources) is not expressible: sends are a single scalar into a shared bus.
- **sources**
    - *[single source — a hypothesis]* [Myloops — How to make uplifting trance leads](https://www.myloops.net/how-to-make-uplifting-trance-leads) — the clearest 3-layer breakdown found: main saw layer at 7 voices, HPF 200 Hz, presence bump at 3 kHz, stereo spread 60–80%; octave-up layer at +12 semitones, 3–5 voices with TIGHTER detune, HPF 500 Hz, soft shelf at 8–10 kHz, sitting 6–10 dB below the main; reverb send starting at −12 dB and delay send at −15 dB, both band-limited
    - *[single source — a hypothesis]* [FaderPro — Supersaw: how to make the iconic sound](https://blog.faderpro.com/techniques/supersaw-how-make-iconic-sound/) — Osc 1 at 7-voice unison, Osc 2 at 3 voices and ~7% detune tuned one octave down; reverb time ≈500 ms at 30–40% mix with the reverb's own EQ cutting lows and highs inside the return; detune past ~50% turns dissonant
    - *[single source — a hypothesis]* [Syntorial — Giant Face-Melting Supersaw Trance Lead](https://www.syntorial.com/tutorials/synth-quickie-supersaw-trance-lead/) — three independently-unisoned saw oscillators plus a white-noise oscillator pitched up four octaves and high-passed; a 12 dB/oct high-pass to 'take some of the frump off the bottom'; the detune target stated perceptually — 'turned up to where it juuuuust starts to sound a little out of tune'
    - *[consensus (3+ sources)]* docs/priors/leads.md consensus 1, 2, 5 — voice count clusters at 7 (the JP-8000 hardware figure) with 9 the next-most-common software number; the main + octave-related + noise/air three-layer structure recurs across four independent sources; the ±12-semitone layer is the single most consistent number in the whole vein
    - *[measured — patch files]* docs/research/141 §3.1/§3.2/§5.2 — 448 lead patches, 1,450 unison stacks — lead amp attack median 3.91 ms (the machine floor; 65.0% sit exactly on it, 80.1% ≤12.5 ms) and release median 31 ms with 33.9% at that default — 'a professional lead does not have a long amp release; the tail comes from the delay and reverb sends'. Our engine-curated leads sit at 13 ms (p81) and 1,213 ms (p91). Voice-count histogram spikes at 7 (126 patches); lead detune median 10.0 ¢ at ≥5 voices — the NARROWEST of the big roles
    - *[measured — owned refs]* docs/research/131 §5 + §7 P2/P4 — gate numbers — elite ref leads are WIDE (−4.6 dB vs engineplus −10.7), noisier in presence (flatnessHiDb −15.8 vs −28.6), with attacks ≤8 ms

**Clip gates** (checked on the summed render) — last verified run: **INCOMPLETE**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandMidsPct` | 35..90 | computable today | 78.63 | **PASS** |
| `bandBassPct` | 0.5..22 | computable today | 12.76 | **PASS** |
| `bandPresencePct` | 2..28 | computable today | 4.73 | **PASS** |
| `bandAirPct` | 0.2..10 | computable today | 3.03 | **PASS** |
| `stereoWidthDb` | -14..-1 | computable today | -9.08 | **PASS** |
| `crestDb` | 10..20 | computable today | 14.05 | **PASS** |
| `attackMedMs` | 0..8 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `flatnessHiDb` | -16..-8 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §5 (top-5 elite ref lead rows) + §7 P2/P4/P5 — packs-ref lead medians and the doc's explicit target bands, as of 2026-07-26.*

### `pluck-delay-lead` v1

*The pluck idiom exactly as the patch corpus measures it: instant attack, sustain at zero, and a long decay/release doing all the shaping — into a delay-first send chain.*

- **tags** — house, melodic, pluck, delay
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `motif-repeat`, register MIDI 60..79
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.75 / 0.6 by metrical position
    - gate ×0.4
    - gate is short deliberately: with sustain at zero the note LENGTH stops mattering to the amplitude, so the figure's articulation is carried by the decay, exactly as the corpus describes
- **layers** (2)
    - **`pluck`** — synth, production role `lead`
        - *why*: the pluck: attack at the floor, sustain at 0.01, and an 870 ms decay with a 640 ms release — the measured patch-file idiom, roughly 4× longer at the tail than anything currently in our own banks.
        - *patch*: `osc`=sawtooth, `osc2Type`=triangle, `osc2Level`=0.35, `osc2Detune`=20, `unisonVoices`=3, `unisonWidth`=0.6, `cutoff`=600, `resonance`=1.5, `attack`=0.004, `decay`=0.87, `sustain`=0.01, `release`=0.64, `filterEnvAmount`=0.85, `filterEnvAttack`=0.001, `filterEnvDecay`=0.64, `filterEnvSustain`=0, `filterEnvRelease`=0.1, `velToFilterAmount`=0.4, `saturatorCurve`=warm, `saturatorDrive`=0.2, `saturatorMix`=0.25, `sendDelay`=0.22, `sendReverb`=0.15, `volume`=-6
        - *solo gates*: `bandMidsPct` 25..94
    - **`shimmer`** — synth, +12 semitones, production role `lead`
        - *why*: a quiet octave-up noise/triangle layer high-passed at 1 kHz — the presence-band texture 131 P4 names as the axis production constants alone have never closed, and which a single filtered saw cannot manufacture.
        - *patch*: `osc`=triangle, `noiseLevel`=0.08, `cutoff`=8000, `resonance`=0.2, `attack`=0.004, `decay`=0.35, `sustain`=0, `release`=0.3, `filterEnvAmount`=0, `unisonVoices`=3, `unisonWidth`=0.8, `eq7HpOn`=true, `eq7HpFreq`=1000, `sendReverb`=0.12, `volume`=-18
        - *solo gates*: `bandPresencePct` 2..70
- **chain** (clip level, in order)
    - `effect-add $shimmer eq7`
- **sweep dials**
    - **pluckDecaySeconds** (`decay`) = 0.87, range 0.25..1.28 — the prose corpus spans 200–300 ms (Myloops's underlayer) to 1.25 s (Zebra 3's filter envelope) with no reconciliation. research 141's 234 pluck patches: decay median 867 ms, IQR 250–1,282 ms — the patch files sit at the LONG end, and our own factory plucks (235 ms) sit near the bottom of the IQR. 0.87 s is encoded; the range is the measured IQR.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - the Zebra 3 recipe's secondary, velocity-sensitive envelope driving the OVERDRIVE stage ~40 ms behind the filter envelope — dotbeat has one filter envelope and one amp envelope, with no third envelope to route at a drive stage.
    - the corpus's band-passed pluck (1–3 kHz bandpass) is expressible via `filterType: 'bandpass'`, but then the SAME filter carries the pluck envelope, so the bandpass and the pluck shape cannot be independent as they are in the source.
    - delay TIME is quoted as a tempo-synced division (dotted eighth) in every source; `pingPongTime` and the shared delay bus are in seconds, so the sync is an unsourced BPM conversion.
- **sources**
    - *[measured — patch files]* docs/research/141 §3.2 — 234 pluck patches — plucks are the ONE transient role that genuinely uses D/S/R: attack median 3.91 ms (88.5% ≤12.5 ms), sustain median 0.011, decay median 867 ms, release median 643 ms (IQR 180–1,505). Stated as the idiom in one line: 'instant attack, sustain at zero, and a long decay/release doing all the shaping' — which is the opposite of factory.json's plucks (decay 235 ms, release 100 ms), 'same idea, ~4× too short at the tail'
    - *[measured — patch files]* docs/research/141 §5.2/§6 — pluck rows — pluck unison detune median 20.0 ¢ at ≥5 voices (the widest of any role); delay is the top effect at 70.9% of pluck patches, ahead of reverb at 40.2% — lead/pluck/sequence are delay-first, bass is EQ+drive-first
    - *[single source — a hypothesis]* [Attack Magazine — Inventing Your Own Patch From Scratch With Zebra 3 (Synth Secrets)](https://www.attackmagazine.com/technique/synth-secrets/inventing-your-own-patch-from-scratch-with-zebra-3/) — the only end-to-end millisecond pluck envelope in the prose corpus: filter envelope Attack 0 ms, Decay 1.25 s, Sustain 31, Release 96.1 ms with mod depth 105, over a cutoff parked effectively closed at rest; plus a slower (~40 ms) secondary envelope on the drive stage so the grit blooms in behind the transient
    - *[single source — a hypothesis]* [Myloops — uplifting trance leads, pluck underlayer](https://www.myloops.net/how-to-make-uplifting-trance-leads) — bandpass ~1–3 kHz, instant attack, decay 200–300 ms, sustain at zero, sitting 12–15 dB below the main layer
    - *[consensus (3+ sources)]* docs/priors/chords-pads.md consensus 8 — stab/pluck amp-envelope attack is consensus-zero across every source that gives a number; punch is a function of decay and release length, which vary from tens of ms to 1.25 s by design intent
    - *[measured — owned refs]* docs/research/131 §5 + §7 P2/P4 — gate numbers — lead attacks ≤8 ms, elite refs wide (−4.6 dB) and noisy in presence (flatnessHiDb −16…−8)

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandMidsPct` | 35..92 | computable today | 70.22 | **PASS** |
| `bandBassPct` | 0.5..22 | computable today | 23.91 | **FAIL** (off by 1.91) |
| `bandPresencePct` | 1.5..28 | computable today | 4.22 | **PASS** |
| `stereoWidthDb` | -16..-1 | computable today | -21.2 | **FAIL** (off by 5.2) |
| `crestDb` | 11..21 | computable today | 16.42 | **PASS** |
| `attackMedMs` | 0..8 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `flatnessHiDb` | -16..-8 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §5/§7 P2/P4/P5 (packs lead ref rows) — packs-ref lead medians and the doc's explicit target bands, as of 2026-07-26.*

### `hoover-lead` v1

*The Alpha Juno 'What The' lineage: a PWM wavetable swirling under an LFO, paired with a widely-detuned saw and doubled an octave down for weight.*

- **tags** — rave, hardcore, hard-dance, hoover
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `long-tones`, register MIDI 55..72
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.82 / 0.7 by metrical position
    - gate ×0.95
    - long, held notes: the hoover is a drone whose interest is the PWM swirl and the (unexpressible) pitch yawn, so the figure gets out of the way
- **layers** (2)
    - **`swirl`** — synth, production role `lead`
        - *why*: the PWM engine: dotbeat's `wtTable: 'pwm'` wavetable with an LFO on `wtPos` is the one honest expression of the Alpha Juno's pulse-width modulation, paired with a saw detuned to the source's own ±40 ¢.
        - *patch*: `osc`=wavetable, `wtTable`=pwm, `wtPos`=0.35, `osc2Type`=sawtooth, `osc2Level`=0.85, `osc2Detune`=40, `unisonVoices`=3, `unisonWidth`=0.3, `cutoff`=3000, `resonance`=4, `attack`=0.004, `decay`=0.3, `sustain`=0.85, `release`=0.05, `filterEnvAmount`=0.2, `filterEnvDecay`=0.25, `filterEnvSustain`=0.6, `lfoDest`=wtPos, `lfoDepth`=0.6, `lfoRate`=5.5, `lfoSync`=false, `distortionAmount`=0.25, `distortionMix`=0.3, `phaserRate`=0.15, `phaserDepth`=1.5, `phaserMix`=0.15, `sendReverb`=0.15, `volume`=-7
        - *solo gates*: `bandMidsPct` 20..92
    - **`weight`** — synth, -12 semitones, production role `lead`
        - *why*: the source's third oscillator at −12 semitones, given its own track so it can be filtered and levelled independently — plus `subLevel` for the ReDominator variant's dedicated sub oscillator.
        - *patch*: `osc`=wavetable, `wtTable`=pwm, `wtPos`=0.5, `osc2Level`=0, `subLevel`=0.3, `unisonVoices`=1, `unisonWidth`=0, `cutoff`=1200, `resonance`=0.6, `attack`=0.004, `decay`=0.3, `sustain`=0.85, `release`=0.05, `filterEnvAmount`=0, `pan`=0, `volume`=-12
        - *solo gates*: `bandBassPct` 5..80
- **sweep dials**
    - **hooverDetuneCents** (`osc2Detune`) = 40, range 27..40 — ±40 ¢ (Alpha Juno hoover) and ±27 ¢ (Reese Redux) are the corpus's recurring two-oscillator 'beating pair' spread across unrelated families. research 141's pooled p90 for a 2-voice stack is 23.8 ¢ and p95 is 44.2 ¢, so this whole range is tail behaviour — encoded at the source's own 40 because the wide beat IS the hoover's identity, not despite the measurement.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - THE HOOVER'S SIGNATURE IS NOT EXPRESSIBLE: both sources route a PITCH ENVELOPE (8 semitones in one, ~an octave at maximum amount in the other) to produce the upward 'yawn' on every note-on. dotbeat has no pitch envelope; `lfoDest: 'pitch'` is a cyclic LFO, not a one-shot. What ships here is a PWM swirl with a wide detuned pair — recognisably hoover-adjacent, and missing the move that names the sound.
    - the source runs THREE PWM oscillators; `osc2Type` has no 'wavetable' entry (engine.ts falls a wavetable osc2 back to a plain sawtooth — ui/src/components/synthParams.ts's own note), so each layer here is one PWM oscillator plus a saw partner, not a PWM pair.
    - the source pans the three unison voices individually across the stereo field; `unisonWidth` is a single spread scalar with no per-voice placement.
- **sources**
    - *[single source — a hypothesis]* [MusicRadar — How to create a classic '90s hoover sound](https://www.musicradar.com/how-to/how-to-create-a-classic-90s-hoover-sound) — the most numerically explicit hoover recipe found: three Pulse-Saw PWM oscillators, Osc 1 and 2 detuned ±40 cents in opposing directions, Osc 3 an octave down (−12 semitones); 3 unison voices at ~0.3 spread, panned across the field; a pitch envelope routed at 8 semitones for the signature note-on 'yawn'; a phaser with rate, feedback and depth all near zero for subtle smearing
    - *[single source — a hypothesis]* [MusicRadar — How to design a Dominator-style hoover with ReDominator](https://www.musicradar.com/how-to/how-to-design-a-dominator-style-hoover-sound-with-audiorealisms-redominator) — PWM depth set to full with a fast PWM rate (~100) as the 'swirl' engine; a dedicated sub oscillator at its own level; pitch-envelope amount at maximum over ~one octave of travel; a VCA only partially envelope-controlled so the patch keeps drone character
    - *[consensus (3+ sources)]* docs/priors/leads.md consensus 4 and 5 — ±40 ¢ / ±27 ¢ is a recurring 'opposing pair' detune spread across unrelated sound families; the −12 semitone layer is the single most consistent number in the whole lead vein, appearing in every recipe that specifies more than one oscillator
    - *[measured — patch files]* docs/research/141 §5.2 — the pooled p90 for a ≥2-voice stack is 32.8 ¢ and p95 is 44.2 ¢, so ±40 ¢ sits deep in the tail of what designers actually dial — deliberate, not central
    - *[measured — owned refs]* docs/research/131 §7 P2/P4/P5 — gate numbers — lead width, presence texture, punch

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandMidsPct` | 30..90 | computable today | 82.7 | **PASS** |
| `bandBassPct` | 2..40 | computable today | 11.7 | **PASS** |
| `bandPresencePct` | 1..30 | computable today | 5.2 | **PASS** |
| `stereoWidthDb` | -18..-1 | computable today | -18.66 | **FAIL** (off by 0.66) |
| `crestDb` | 8..19 | computable today | 13.08 | **PASS** |
| `fluxMean` | 0.1..0.45 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §7 P2/P4/P5 (packs lead ref rows), band-share gates widened for a deliberately mid-heavy drone — packs-ref lead medians as p25–p75 bands, as of 2026-07-26.*

### `layered-lead-stack` v1

*The lead vein's consensus architecture as three real tracks: a wide main unison layer, MusicTech's quantified octave-up layer, and Syntorial's noise/air layer two octaves up with its own high-pass.*

- **tags** — layered, trance, melodic, architecture
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `call-response`, register MIDI 64..79
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - velocity tiers 0.95 / 0.8 / 0.65 by metrical position
    - gate ×0.85
- **layers** (3)
    - **`main`** — synth, production role `lead`
        - *why*: the wide main layer: seven unison saws at the measured lead detune median, high-passed at 200 Hz — the reference level every other layer is set against.
        - *patch*: `osc`=sawtooth, `osc2Type`=sawtooth, `osc2Level`=0.6, `osc2Detune`=10, `unisonVoices`=7, `unisonWidth`=0.8, `cutoff`=8000, `resonance`=0.5, `attack`=0.004, `decay`=0.3, `sustain`=0.6, `release`=0.031, `filterEnvAmount`=0.3, `filterEnvDecay`=0.25, `filterEnvSustain`=0.5, `velToFilterAmount`=0.3, `eq7HpOn`=true, `eq7HpFreq`=200, `saturatorCurve`=analog, `saturatorDrive`=0.25, `saturatorMix`=0.3, `sendReverb`=0.15, `sendDelay`=0.14, `volume`=-6
        - *solo gates*: `stereoWidthDb` -14..-1, `bandMidsPct` 25..92
    - **`octave-up`** — synth, +12 semitones, production role `lead`
        - *why*: MusicTech's numbers verbatim: +12 semitones, four voices with tighter detune, high-passed at 500 Hz, 8 dB below the main — inside their stated 6–10 dB window.
        - *patch*: `osc`=sawtooth, `osc2Level`=0, `unisonVoices`=4, `unisonWidth`=0.45, `cutoff`=12000, `resonance`=0.3, `attack`=0.004, `decay`=0.3, `sustain`=0.6, `release`=0.031, `filterEnvAmount`=0, `eq7HpOn`=true, `eq7HpFreq`=500, `eq7HighShelfOn`=true, `eq7HighShelfFreq`=9000, `eq7HighShelfGain`=3, `sendReverb`=0.12, `volume`=-14
        - *solo gates*: `bandPresencePct` 2..70, `bandBassPct` 0..20
    - **`air`** — synth, +24 semitones, production role `lead`
        - *why*: Syntorial's noise/air layer: two octaves up, carrying a real noise mix, widely spread and high-passed at 3 kHz — the presence-band texture 131 P4 identifies as the one axis production constants have never closed, because 'EQ can't boost something that isn't there in the first place'.
        - *patch*: `osc`=triangle, `noiseLevel`=0.16, `cutoff`=12000, `resonance`=0.2, `attack`=0.01, `decay`=0.4, `sustain`=0.5, `release`=0.2, `filterEnvAmount`=0, `unisonVoices`=3, `unisonWidth`=0.9, `eq7HpOn`=true, `eq7HpFreq`=3000, `sendReverb`=0.15, `volume`=-20
        - *solo gates*: `bandAirPct` 1..80, `bandPresencePct` 2..80
- **chain** (clip level, in order)
    - `effect-add $main eq7`
    - `effect-add $octave-up eq7`
    - `effect-add $air eq7`
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - Syntorial's noise layer is PITCHED white noise (up four octaves) with its own unison stack. dotbeat's `noiseLevel` mixes unpitched noise into the layer's own oscillator path, so what ships here is a high-passed triangle+noise voice two octaves up — closer than a single-voice patch can get, and still not the same generator.
    - 'the same unison settings as Osc 1–3' cannot be honoured exactly: the noise mix rides the layer's single oscillator bank, so its unison spread is the layer's, not a per-source setting.
    - the corpus's band-split compression on lead stacks (KVR: ~12 dB gain reduction on a frequency-split HIGH band while the low end of the same stack is 'kept mostly untouched') is a multiband move; the per-layer split here is the layered approximation.
- **sources**
    - *[consensus (3+ sources)]* docs/priors/layering.md §3 — consensus across MusicTech, Syntorial, KVR and FaderPro — the named architecture is main saw layer + octave-up layer + noise/air layer, arrived at independently by four sources — 'strong convergent evidence this is the load-bearing structure for the sound, not a specific plugin's idiom'
    - *[single source — a hypothesis]* [MusicTech — Creating huge leads with synth layering](https://musictech.com/guides/essential-guide/creating-huge-leads-with-synth-layering/) — 'the single most quantified second layer recipe found in the whole search': the octave-up layer drops to 3–5 unison voices with tighter detune, is high-passed around 500 Hz, and sits 6–10 dB below the main layer
    - *[single source — a hypothesis]* [Syntorial — Giant Face-Melting Supersaw Trance Lead](https://www.syntorial.com/tutorials/synth-quickie-supersaw-trance-lead/) — the noise layer is white noise pitched up FOUR octaves, given the same unison settings as the saw oscillators, then high-passed — and mixed so it is 'very audible', explicitly not a subtle sheen
    - *[consensus (3+ sources)]* docs/priors/layering.md §6 + §3 — the anti-layering consensus — 'three well-crafted layers usually sound better than seven fighting for space'; the octave-related layer is present in every recipe that specifies more than one oscillator and is the strongest structural pattern in the vein — 'stronger than any single voice-count or detune-cents number'
    - *[measured — patch files]* docs/research/141 §5.3 — layering within a patch is the majority idiom (lead 54.9% multi-oscillator) and the dominant FORM is the octave split (37.9% of all leads) — 'most multi-oscillator patches are octave layers, not chorus-detune pairs'
    - *[measured — owned refs]* docs/research/131 §5 (lead row) + §7 P4 — gate numbers, and the reason: elite refs are WIDE (−4.6 vs −10.7 dB), darker in tilt, and noisier in presence (flatnessHiDb −15.8 vs −28.6) with crest_presence 19.8 vs 9.9 dB — the texture axis production constants alone have never closed

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandMidsPct` | 30..88 | computable today | 84.14 | **PASS** |
| `bandBassPct` | 0.5..22 | computable today | 0.25 | **FAIL** (off by 0.25) |
| `bandPresencePct` | 2..30 | computable today | 8.93 | **PASS** |
| `bandAirPct` | 0.3..12 | computable today | 6.2 | **PASS** |
| `stereoWidthDb` | -12..-1 | computable today | -9.82 | **PASS** |
| `crestDb` | 10..20 | computable today | 14.58 | **PASS** |
| `attackMedMs` | 0..8 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `flatnessHiDb` | -16..-8 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §5 (top-5 elite ref lead rows) + §7 P2/P4/P5 — elite-ref medians widened to the packs p25–p75 band, as of 2026-07-26.*


## Drum loop — density and steadiness (research 131 §7 P6; winners are fuller, not spikier)

### `layered-house-kit` v2

*A swung four-to-the-floor kit tuned against 131's measured density targets: kick pulled back so it stops drowning the loop, open hats carrying air, and light bus glue rather than heavy compression.*

- **tags** — house, tech-house, swing, kit
- **status** — `sourced` (sourced → verified → validated | parked)
- **figure** — archetype `four-floor`, register MIDI 24..48
- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)
    - swing **62.5%** (grid 1)
    - velocity tiers 0.95 / 0.72 / 0.5 by metrical position
    - `figure.register` is inert for the drum-loop role (there are no pitched notes to transpose); it is required by the schema so every recipe reads the same way
- **layers** (1)
    - **`kit`** — drums, production role `kit`
        - *why*: one drums track carrying all five lanes: the kick tuned to 45 Hz with a shortened decay so it stops taking 60% of the loop's energy, open hats given a long decay to carry the air band, and light parallel bus compression rather than the heavy squash the corpus explicitly warns against.
        - *patch*: `kickTune`=45, `kickPunch`=0.015, `kickDecay`=0.32, `snareTone`=0.35, `snareDecay`=0.16, `hatDecay`=0.05, `openHatDecay`=0.45, `hatTone`=6500, `cutoff`=14000, `resonance`=0.1, `compThreshold`=-18, `compRatio`=4, `compAttack`=0.008, `compRelease`=0.12, `compMix`=0.6, `saturatorCurve`=warm, `saturatorDrive`=0.25, `saturatorMix`=0.3, `eqHigh`=2.5, `volume`=-5
        - *solo gates*: `bandSubPct` 15..60, `bandAirPct` 1..15
- **chain** (clip level, in order)
    - `effect-add $kit eq7`
    - `set $kit.eq7HighShelfOn true`
    - `set $kit.eq7HighShelfFreq 11000`
    - `set $kit.eq7HighShelfGain 2.5`
- **sweep dials**
    - **swingPct** (`shuffleAmount`) = 62.5, range 50..80 — the corpus's third named contradiction. Attack Magazine's Beat Dissected series puts nominally-similar house subgenres at 60–65% (jackin', deep tech), 50–60% (organic tech-house) and 70–80% ('dusted' lo-fi) — same publication, same editorial voice, a 30-point spread. SampleFocus's DAW-agnostic usable band is 52–70% with triplet at 66.7%. NO patch corpus measures swing, so unlike every other dial here this value is a prose midpoint (of the four Beat Dissected bands), not a measured median — and it is flagged as such rather than dressed up.
- **gaps** — what this recipe's sources ask for that dotbeat cannot express
    - the corpus's actual kick/clap/hat construction is 2–5 SAMPLES per hit with complementary EQ carving per layer (Attack's tech-house kick is three tuned layers; its snare stack is five). dotbeat's drums track is ONE voice bus over five lanes, so the 'layering' expressible here is per-lane voice tuning, not per-hit sample stacking — the biggest structural gap in this recipe.
    - per-layer MICRO-TIMING offsets of 5–20 ms, named across three sources as the glue that fuses a multi-sample stack into one perceived hit — hits sit on a 16th grid and `humanize` is a CLI verb, not a v1 recipe step.
    - 'ghost notes at 40–60% velocity' and hat velocity ALTERNATION (~80/~100 out of 127, the 'tick-TOCK' wrist-stroke feel) are per-hit patterns; the builder applies velocity by metrical position only.
    - there is no group bus (research 115 §1.2), so the ~4 dB glue compression is the track's own comp insert rather than a real drum-bus compressor.
    - MEASURED TRAP, found by verifying v1: `kickPunch` is not a 0–1 'amount' despite the GUI rendering it as a percentage knob (ui/src/components/synthParams.ts: `k('kickPunch','KickPch',0,1,fmt.pct)`) — it is Tone.MembraneSynth's `pitchDecay` in SECONDS, over a 7-octave pitch sweep (ui/src/audio/engine.ts:2179/3390). v1 shipped 0.35, i.e. a 350 ms fall from ~5.8 kHz to 45 Hz under a 320 ms amp decay, and the loop measured 1.49% sub share against an 18–55% gate — a kick with essentially no sub. v2 uses 0.015, the sourced 10–20 ms drop. Any recipe or preset author reading the GUI will make the same mistake.
- **sources**
    - *[corroborated (2 sources)]* docs/priors/drums.md — Attack Magazine Beat Dissected series (jackin' house, deep tech house, organic tech-house, dusted deep house) — swing percentages by subgenre from one publication and editorial voice: jackin' house 60–65% at 120–125 BPM, deep tech house 60–65% at 125–130, organic tech-house 50–60% at 122–129, dusted deep house 70–80% at 120–125
    - *[single source — a hypothesis]* [SampleFocus — Swing, Shuffle and Humanization: How To Program Grooves](https://samplefocus.com/blog/swing-shuffle-and-humanization-how-to-program-grooves/) — general usable swing 52–70% with true triplet shuffle at 66.7%; hi-hats take 10–15% velocity randomization (often alternating ~80 and ~100 of 127), kick and snare only 5–8% because they are the anchor, and ghost notes sit at 40–60% velocity
    - *[consensus (3+ sources)]* docs/priors/drums.md consensus 4 — bus/glue compression on drum groups is consistently LIGHT (~4 dB gain reduction, fast attack, program-dependent release); aggressive parallel compression is reserved for snares specifically, not the whole kit
    - *[consensus (3+ sources)]* docs/priors/drums.md — kick+bass coexistence synthesis — the recurring EQ anchor is 40–80 Hz for kick sub-weight with the low-mids above it scooped; sidechain attack ~4 ms is the single most load-bearing number, chosen to avoid an audible click
    - *[single source — a hypothesis]* [Futureproof Music School — How to Make Hard Techno (via docs/priors/bass-techno.md A5)](https://futureproofmusicschool.com/blog/making-hard-techno-a-path-to-unique-sound-design) — the main kick's pitch envelope drops from a higher pitch to the fundamental over the first 10–20 ms for punch, with the kick tuned to the track key
    - *[measured — owned refs]* docs/research/131 §5 + §7 P6 — gate numbers — winning drum loops are FULLER and STEADIER, not spikier: sustainPct ≥45% (ref 51 vs engineplus 27), envRangeDb ≤25 (vs 44), onsetLevelCv ≤0.6 (ref 0.59 vs 0.87), crest_subDb ≤20 (ref 16.5 vs 43.4), broadband crest 12–15 dB
    - *[measured — owned refs]* docs/research/138 §2 free win 13 — engineplus drum sub share is 60.2% — the kick is drowning the kit; target 25–40% via a −2…−3 dB kick lane or a shorter kickDecay, plus velocity tiers, ghosts and 54–58% hat swing

**Clip gates** (checked on the summed render) — last verified run: **FAIL**:

| gate | band | key status | measured | verdict |
|---|---|---|---|---|
| `bandSubPct` | 18..55 | computable today | 70.29 | **FAIL** (off by 15.29) |
| `bandMidsPct` | 4..45 | computable today | 0.69 | **FAIL** (off by 3.31) |
| `bandAirPct` | 1.5..12 | computable today | 5.08 | **PASS** |
| `crestDb` | 9..18 | computable today | 16.44 | **PASS** |
| `sustainPct` | 45..100 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `envRangeDb` | 0..25 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `onsetLevelCv` | 0..0.6 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |
| `crest_subDb` | 0..20 | `pending` — 131 §4 key, waits on 138 B0 | — | `pending` |

*Gates mined from docs/research/131 §5/§7 P6 (packs drum-loop ref rows) + 138 §2 row 13 — packs-ref medians as p25–p75 bands; the sustain/envRange/onsetLevelCv/crest_sub rows are 131 P6's explicit targets. GATES ARE UNCHANGED from v1 — v2 bumps only because a PATCH value changed (kickPunch 0.35 -> 0.015, see gaps), which is what mints a version under the frozen-science rule., as of 2026-07-26.*

---

## Growth and graduation (research 139 §6.3)

- **`sourced`** — the recipe executes end-to-end on a scratch project. Every recipe ships here.
- **`verified`** — a seeded reference build renders deterministically and passes every gate;
  the feature receipt is stored in `provenance.verifyReceipt`. **Unreachable today for any recipe
  whose gates reach for a 131 §4 discriminator** — the loader refuses the status while a gate is
  pending, and 138's B0 feature upgrade is the prerequisite.
- **`validated`** — the recipe's arm beat its pre-registered control in blind rating; one
  `blindRecord` entry per rated batch, append-only.
- **`parked`** — failed validation twice, record intact. A re-mine or redesign is a NEW version
  beside the old one; the failure stays attached to the version that earned it. That is what makes
  the library evidence rather than lore.

Gates regenerate from the growing rated log by script and mint a new recipe `version`; procedures
and sources freeze per version; the blind record only ever appends (CLAUDE.md's frozen-science
rule, the `engineplusProfile` precedent).

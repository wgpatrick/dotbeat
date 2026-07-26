# Research 141 — Parameter ground truth mined from 3,559 professionally designed patches

*Run 2026-07-26, commissioned to close a gap the prose-mining fleet could not: a sibling pass
searched exhaustively and found that **no tutorial source states lead/pluck attack times in
milliseconds** — it is all qualitative ("instant", "snappy", "fast"). But patch designers encode
real numbers, so this pass reads the patches instead of the prose. Corpus: every `.fxp` under
`$SURGE_DATA_HOME` (`tools/surge/resources/data`) — **639 factory + 2,920 bundled third-party =
3,559 patches** by 37 named designers, the third-party pool having never been enumerated by our
eval (`python/surge_render.py` walks `patches_factory` only). Method: `.fxp` is a VST2 FXP wrapper
around Surge's own XML patch dump; every patch was parsed directly (no GUI), converted to natural
units against a code read of `tools/surge/src/common/Parameter.cpp`, `SurgePatch.cpp`,
`SurgeStorage.cpp` and `dsp/modulators/ADSRModulationSource.h`, then **verified against Surge
itself**: 500 randomly sampled patches were loaded in the repo's own `surgepy` build and every
converted value compared to Surge's `getParamDisplay()` string (§2). Confidence: **High** =
verified against surgepy on ≥400 patches and n ≥ 150 in the reported cell; **Medium** = n 25–150,
or one unresolved confound (modulation routings, dual scenes); **Low** = n < 25 or a derived proxy.
Companions: 131 (the measured quality gap this answers), 134 §2 (the E2 curation post-mortem), 139
§4.3 (preset retargeting). Deliverables: this doc + `presets/role-parameter-stats.json` (the
machine-usable per-role distributions). Scratch pipeline:
`~/.claude/jobs/fc3bd856/tmp/presetmine/` (`extract.py`, `verify.py`, `analyze.py`, `analyze2.py`,
`compare2.py`, `final.py`, `patches.jsonl`). Research only — no code changed; the repo was read-only
apart from this doc and the JSON artifact.*

## Headline answers

1. **Professional lead attacks are not "around 6 ms" — they are at the machine's floor.** The
   median amp-EG attack of the 448 lead patches is **3.91 ms**, which is Surge's *minimum*
   (`ct_envtime` raw −8 = 2⁻⁸ s; the UI prints it as "0.00 s"). **65.0% of lead patches sit exactly
   on that floor**, 68.8% are ≤ 6 ms, 80.1% are ≤ 12.5 ms, 86.2% are ≤ 20 ms; only 4.7% exceed
   100 ms. So 131's 6.1 ms commercial-loop benchmark is not a target designers aim *at* — it is what
   you measure from audio when the patch author asked for zero and the oscillator, filter and
   converter add the rest. **The defensible instruction is "ask for 0, accept ≤ 12 ms," not "set
   6 ms."** Our engine-curated leads sit at a median 13 ms, the 81st percentile of this
   distribution. (High.) §3, §7
2. **Plucks are the same answer, harder; basses too; keys nearly; pads are the one genuine
   exception.** Median amp-EG attack, p25–p75 in brackets: **pluck 3.91 ms** [3.91–7.15], 88.5%
   ≤ 12.5 ms; **bass 3.91 ms** [3.91–8.16], 83.2% ≤ 12.5 ms; **keys 4.78 ms** [3.91–10.10], 78.3%
   ≤ 12.5 ms; **sequence/arp 3.91 ms**, 83.0% ≤ 12.5 ms; **drum/percussion 3.91 ms**, 92.7%
   ≤ 12.5 ms. **Pad: 540.6 ms** [69.97–1405.3], only 16.7% ≤ 12.5 ms and 71.4% > 100 ms — pads are
   a *different distribution*, not a slower tail of the same one. Atmospheres/textures land between
   (median 100 ms). Brass 21.4 ms, strings 39.6 ms, winds 38.7 ms — the acoustic-imitative roles are
   the only other slow ones. (High for lead/pluck/pad/bass/keys/sequence/drum; Medium for
   brass/strings/wind, n = 65–86.) §3
3. **Attack is the parameter designers touch least and default most — which is itself the finding.**
   65–68% of leads/plucks/basses/sequences leave attack at Surge's INIT minimum. Contrast release
   (only 10–34% at default) and decay (8–33%). The professional idiom for a transient role is *the
   amp envelope does nothing at the front*; every bit of shaping happens in the filter EG, and 85.7%
   of leads use the plain linear attack curve, so there is no hidden convexity making the ramp
   effectively shorter. (High.) §3.3
4. **The supersaw question, settled: the professional centre is 3–7 voices at ±10–20 cents, and
   the tutorials' ±61 is a 97th-percentile outlier.** Across all 1,450 patches with unison on, the
   voice-count histogram peaks at **2 (404), 3 (272), 4 (157), 7 (126)**, with a secondary spike at
   Surge's maximum **16 (100)**; median-when-on is 4. Detune (Surge's ± half-spread; total stack
   width is 2×): for stacks with ≥3 voices **median 11.4 ¢, IQR 6.0–20.0, p90 35.9, p95 47.3**
   (n = 1,426); for ≥5 voices **median 13.5 ¢, IQR 6.5–22.9, p90 39.0** (n = 810); for ≥7 voices
   median 13.5 ¢, p95 60.2. Per role at ≥5 voices: pad 17.7 ¢, pluck 20.0 ¢, polysynth 20.0 ¢,
   bass 16.6 ¢, lead 10.0 ¢, keys 10.0 ¢. **±7 ¢ is the 27th percentile, ±10 ¢ the 37th, ±20 ¢ the
   68th, ±30 ¢ the 87th, and ±61 ¢ the 97th** — the tutorial range is real but wildly uncentred. (High.) §5.2
5. **Layering-within-a-patch is the majority idiom but not by a landslide, and octave splitting is
   the specific form it takes.** Two or more audible oscillators: lead 54.9%, bass 56.7%, pad 56.6%,
   keys 51.7%, pluck 44.9%, chords 85.7%. Of those, an **octave split** (active oscillators at
   different octaves) is present in lead 37.9%, bass 37.7%, pad 38.7%, keys 35.9%, chords 78.6% —
   i.e. *most multi-oscillator patches are octave layers*, not chorus-detune pairs. Additional
   layers stack on top: waveshaper 53.8% of leads / 62.8% of basses, cross-FM 27.5% / 29.8%, noise
   15.0% / 13.4%, ring-mod ~9%, second filter 61.2% / 56.1%, and 7.6–21.6% run a whole second scene.
   A professional patch is a **stack**, not a voice. (High.) §5.3
6. **Our banks are far from these distributions in a consistent direction: too slow at the front,
   too long at the back, single-voice, and static.** Worst offenders (our median vs the role's Surge
   median): `engine-curated.json` lead **attack 13 ms vs 3.91 (3.3×, p81)**, **release 1,213 ms vs
   31 (38.8×, p91)**, **decay 176 ms vs 871 (0.20×, p15)**, **1 oscillator vs 2**, **unison off in
   180/181 kept presets**; chords **attack 34 ms vs 4.8 (6.9×, p89)**, **release 862 ms vs 31
   (27.6×, p100)**, **1 osc vs 3**; bassline **attack 20.5 ms vs 3.91 (5.25×, p88)**, **release
   642 ms vs 39 (16.6×, p89)**. `factory.json`'s hand-authored presets are much closer on envelope
   (lead attack 2 ms, pad 500 ms vs 541) but sit at **p87–p93 for cutoff** in every role — they are
   the *bright static* failure mode, not the dark one. Root cause is mechanical: the roll generator
   (`scripts/curate-engine-presets.mjs:rollParams`) emits exactly **8 of the format's 9 core synth
   params and none of its 136 optional fields**, and samples attack log-uniform over [2 ms, 800 ms]
   — a prior whose median is 40 ms against a corpus whose median is 3.91. (High.) §7
7. **Two free wins fell out of the mining. (a)** The eval's Surge draw pool is 639 patches; the
   installed corpus is 3,559. `python/surge_render.py:_patches_root` only ever resolves
   `patches_factory`, so **2,920 professionally designed patches — including 317 more leads, 377
   more basses, 354 more pads, 123 more plucks — are invisible to the showdown**. **(b)** The
   `chords` role maps to `['Pads','Keys']` (`src/taste/showdown.ts:845`) and all 16 curated chords
   picks came from **Pads**, whose attack median is 810 ms. The curation is not to blame (the picks
   sit at p48 of their own draw pool); the *mapping* is. Surge's own `Chords` (median 4.83 ms) and
   `Polysynths` (3.91 ms) categories are never drawn. Given 131's finding that fast attacks win
   chords pairs, this single mapping line is plausibly costing the arm outright. (High.) §7.3
8. **The conversion is not a guess — it was checked against Surge.** On a 500-patch random sample
   loaded in `surgepy`: filter cutoff **500/500**, resonance **500/500**, amp-EG sustain
   **500/500**, unison detune **419/419**, amp-EG decay 482/497, release 473/496, attack 221/494.
   **Every single mismatch is one known class**: at raw −8 Surge *prints* "0.0 ms" while the digital
   envelope actually ramps over 2⁻⁸ s = 3.906 ms. That discrepancy is a display convention, not a
   conversion error, and it is why "the median professional lead attack is 3.91 ms" and "the median
   professional lead attack is zero" are both true statements. (High.) §2

## 1. The corpus, role classification, and the ambiguity I could not remove

`.fxp` is a VST2 preset container; Surge writes its whole patch as a UTF-8 XML document inside the
chunk (`<patch revision="N"><meta …/><parameters>…`). Nothing about reading it needs Surge running,
which is why 3,559 patches parse in 3 seconds.

| pool | patches | source |
|---|---|---|
| `patches_factory` | 639 | Surge XT factory content (17 categories) |
| `patches_3rdparty` | 2,920 | 37 named designer banks, each `<Author>/<Category>/` |
| **total** | **3,559** | |

**Role = the patch author's own directory name.** Factory patches take the first path component;
third-party patches take the second (the author folders use the same category vocabulary). No
listening, no heuristics, no filename parsing — a `Leads/` patch is a lead because its designer
filed it there. Synonymous folder names were folded (`Bass`→`Basses`, `Synths`→`Polysynths`,
`Arps`/`Rhythms`→sequence, `Ambiance`/`Ambiances`/`Soundscapes`/`Textures`/`Drones`→atmos,
`Mallets`→bell, `Woodwinds`→winds, `Voices`/`Vocals`→vox), and eight non-role folders were
**excluded outright**: `Templates`, `Tutorials`, `Splits`, `MPE`, `Vocoder`, `Modelled`,
`Audio In`, and third-party bank roots — 94 patches, because they are demonstrations or I/O
plumbing, not sounds for a role.

| role | n | role | n | role | n |
|---|---|---|---|---|---|
| bass | 494 | lead | 448 | pad | 419 |
| keys | 315 | drum | 286 | fx | 238 |
| pluck | 234 | sequence | 230 | atmos | 196 |
| polysynth | 189 | wind | 86 | brass | 75 |
| strings | 65 | bell | 52 | organ | 40 |
| guitar | 39 | vox | 31 | chords | 28 |

**Ambiguity I handled explicitly, and what remains:**

- **Which scene sounds.** Surge patches have two scenes. In single mode (2,960 patches) only the
  scene named by `scene_active` sounds — and 32 patches point at scene B, so reading scene A blindly
  would have silently mis-measured them (`patches_factory/Leads/Photon.fxp` is the one that caught
  this in verification). I measure the **sounding** scene. **554 dual and 45 split patches also
  sound scene B, which I do not measure** — a real 16.8% blind spot, biggest in keys (21.6% dual)
  and sequences (35.2%).
- **`Polysynths` vs `Chords`.** Surge has both, with only 8 factory + 20 third-party in `Chords`.
  I kept them separate rather than merging, and report `chords` as Medium (n = 28) throughout.
- **`Atmospheres`/`Pads`.** Both are sustained, but their attack distributions differ by 5×
  (pad median 541 ms, atmos 100 ms), so merging them would have destroyed the finding. Kept apart.
- **`Rhythms`/`Sequences`/`Arps`.** Merged into `sequence`; these are all "the patch plays a
  pattern," and their envelope distributions are statistically indistinguishable from each other.
- **Unresolvable:** a patch filed under `Leads` may be a pad the designer expected you to play
  melodically. There is no fix short of listening to 3,559 patches, and the effect is to *widen*
  every distribution, not to shift it — which makes the tight lead/pluck attack result stronger,
  not weaker.

## 2. The conversion, and how it was verified against Surge itself

Surge stores parameters in internal units. The four that matter here:

| parameter | stored | natural units | source |
|---|---|---|---|
| envelope times (A/D/R) | float, range −8 … 5 | **seconds = 2^raw** → 3.906 ms … 32 s | `Parameter.cpp:790` (`ct_envtime` range), `SurgeStorage.cpp:3045` (`table_envrate_linear[i] = 1/k`, `k = sr·2^((i−256)/16)/BLOCK_SIZE` = number of blocks in 2^x seconds) |
| filter cutoff | float, range −60 … 70 | **Hz = 440 · 2^(raw/12)** (13.75 Hz … 25,088 Hz) | `Parameter.cpp:646` |
| resonance, sustain, levels | float 0…1 | as stored (`ct_percent`) | `SurgePatch.cpp:471` |
| unison detune | float 0…1 | **cents = raw · 100** (×12 when `extend_range=1`) | `Parameter.cpp:1659` (`LinearWithScale`, scale 100, unit "cents") |

Two identifications had to be nailed down before any of this meant anything:

- **`env1_*` is the AMP envelope and `env2_*` is the FILTER envelope**, not the other way round.
  `SurgePatch.cpp:500` names them `et = (e == 1) ? "feg" : "aeg"` while the XML tag prefix is
  `env%i_` with `ctrlgroup_entry + 1` (`Parameter.cpp:55`), and `SurgeVoice.cpp:325` wires
  `filterEGSource` to `adsr[1]`. Confirmed independently by `surgepy.constants.adsr_ampeg == 0`.
  Getting this backwards would have swapped every headline number in §3.
- **Unison detune is the ± half-spread.** `OscillatorDriftUnisonCharacter.h:196` gives
  `detune(voice) = bias·voice + offset` spanning exactly [−1, +1], multiplied by the parameter in
  *semitones*. So a patch displaying "20 cents" spans **40 cents total** across the stack. Every
  cents figure in this doc is the ± convention (which is also how the tutorials quote it).

**Verification.** `verify.py` loads a 500-patch random sample in the repo's own `surgepy` build
(`tools/surge/build/src/surge-python`, Surge 1.4.main.c5d6735) and compares each converted value to
Surge's own rendered display string:

| parameter | agreement | residual |
|---|---|---|
| filter 1 cutoff (Hz) | **500/500** | — |
| filter 1 resonance | **500/500** | — |
| amp-EG sustain | **500/500** | — |
| osc 1 unison detune (cents) | **419/419** | — |
| amp-EG decay | 482/497 | 15 × display floor |
| amp-EG release | 473/496 | 23 × display floor |
| amp-EG attack | 221/494 | 273 × display floor |
| **all mismatches** | **311** | **311/311 = the display floor** |

The single residual class: **Surge's UI prints "0.0 ms" at raw −8** (`ct_envtime` sets
`kHasCustomMinValue` with `minLabelValue = 0`), while the default *digital* envelope actually ramps
over 2⁻⁸ s = 3.906 ms with no clamping. (The optional "analog" envelope mode — used by 6.2% of
leads — does clamp its coefficient to ≤ 1, making raw −8 a sub-millisecond one-block ramp.) So
3.906 ms in this doc means "the designer asked for zero." I report the DSP number rather than the
display number because a rendering engine has to produce *some* ramp, and 3.9 ms is what Surge
produces.

Verification also found two real decoding bugs that a naive parse would have shipped silently:

- **Old streaming revisions write float parameters as integers.** `pdata` is a union; when the XML
  says `type="0"` on a float param, `SurgePatch.cpp:1901` calls `set_storage_value(int)` which does
  `val.i = i` and the DSP then reads `val.f`. The stored integer is the **IEEE-754 bit pattern**.
  `patches_factory/Plucks/Friendly.fxp` stores unison detune as `1045220557` = `0x3E4CCCCD` = 0.2 =
  20 cents. 22 distinct streaming revisions appear in the corpus (4 … 30; the three commonest are
  20, 9 and 17), so this affects a large minority of third-party patches.
- **63 of 21,354 stored unison-voice values are outside Surge's declared 1…16 range** (very old
  revisions). Clamped exactly as Surge's `bound_value()` does on load, and counted.

## 3. Amp envelope: the distributions this pass exists to produce

### 3.1 Attack (ms) — amp EG, sounding scene

| role | n | min | p10 | p25 | **median** | p75 | p90 | max | %at floor | %≤6 ms | %≤12.5 ms | %≤20 ms | %>100 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **lead** | 448 | 3.91 | 3.91 | 3.91 | **3.91** | 9.77 | 32.8 | 1,796 | 65.0 | 68.8 | 80.1 | 86.2 | 4.7 |
| **pluck** | 234 | 3.91 | 3.91 | 3.91 | **3.91** | 7.15 | 13.7 | 892 | 65.8 | 72.2 | 88.5 | 91.9 | 1.7 |
| **pad** | 406 | 3.91 | 3.91 | 69.97 | **540.64** | 1,405 | 2,955 | 20,221 | 13.5 | 15.0 | 16.7 | 17.7 | 71.4 |
| **bass** | 494 | 3.91 | 3.91 | 3.91 | **3.91** | 8.16 | 29.7 | 4,080 | 65.8 | 72.5 | 83.2 | 86.8 | 4.7 |
| **keys** | 314 | 3.91 | 3.91 | 3.91 | **4.78** | 10.10 | 41.0 | 3,829 | 43.9 | 55.7 | 78.3 | 84.4 | 4.1 |
| polysynth | 188 | 3.91 | 3.91 | 3.91 | 3.91 | 21.22 | 129 | 5,349 | 50.0 | 56.4 | 68.1 | 73.9 | 10.6 |
| chords | 28 | 3.91 | 3.91 | 3.91 | 4.83 | 6.03 | 24.9 | 42 | 50.0 | 53.6 | 85.7 | 89.3 | 0.0 |
| sequence | 229 | 3.91 | 3.91 | 3.91 | 3.91 | 6.97 | 30.0 | 6,838 | 68.6 | 72.5 | 83.0 | 86.9 | 6.6 |
| bell | 52 | 3.91 | 3.91 | 3.91 | 5.16 | 14.26 | 20.0 | 621 | 34.6 | 51.9 | 71.2 | 88.5 | 5.8 |
| brass | 75 | 3.91 | 3.91 | 3.91 | 21.37 | 54.5 | 512 | 5,194 | 29.3 | 32.0 | 40.0 | 45.3 | 17.3 |
| strings | 65 | 3.91 | 3.91 | 3.91 | 39.63 | 260 | 844 | 11,800 | 27.7 | 40.0 | 44.6 | 47.7 | 43.1 |
| atmos | 193 | 3.91 | 3.91 | 9.31 | 100.00 | 1,092 | 1,996 | 10,714 | 17.6 | 19.7 | 32.1 | 36.8 | 50.8 |
| drum | 286 | 3.91 | 3.91 | 3.91 | 3.91 | 3.91 | 9.3 | 1,554 | 75.9 | 86.0 | 92.7 | 94.8 | 1.4 |
| wind | 86 | 3.91 | 3.91 | 6.13 | 38.70 | 153 | 609 | 6,097 | 22.1 | 24.4 | 31.4 | 33.7 | 32.6 |
| fx | 234 | 3.91 | 3.91 | 3.91 | 3.91 | 50.25 | 835 | 12,996 | 58.1 | 62.8 | 67.5 | 69.2 | 20.5 |

The shape is bimodal by role, not continuous: **transient roles pile on the floor with a thin slow
tail; sustained roles are broad and centred in the hundreds of ms.** There is no "typical attack" —
there is a floor-mass fraction and a tail.

**Does this support the ~6 ms benchmark?** Directionally yes, literally no. 131 measured commercial
Splice leads at 6.1 ms and chords at 12.5 ms *from audio* (10→90% rise at detected onsets); this
corpus says designers of comparable material set the control to **its minimum** in two-thirds of
cases. Those are consistent: an oscillator starting from a random phase into a resonant filter and a
saturator does not reach 90% in 3.9 ms. The usable form of the finding is a **band, not a point**:
`attack ≤ 12 ms` covers 80% of professional leads, 88% of plucks, 83% of basses; `attack ≤ 6 ms`
covers ~70%. Anything above ~30 ms puts you in the top decile for a transient role.

### 3.2 Decay / sustain / release (ms and 0…1)

| role | decay p25/med/p75 | sustain p25/med/p75 | release p25/med/p75/p90 |
|---|---|---|---|
| lead | 250 / **871** / 1,000 | 0.66 / **1.00** / 1.00 | 31 / **31** / 332 / 1,138 |
| pluck | 250 / **867** / 1,282 | 0.00 / **0.01** / 1.00 | 180 / **643** / 1,505 / 2,408 |
| pad | 250 / **1,000** / 3,322 | 0.68 / **1.00** / 1.00 | 611 / **1,803** / 3,000 / 5,238 |
| bass | 250 / **621** / 1,080 | 0.33 / **1.00** / 1.00 | 31 / **39** / 248 / 797 |
| keys | 250 / **1,000** / 2,990 | 0.00 / **0.45** / 0.84 | 77 / **490** / 1,533 / 2,283 |
| chords | 132 / **250** / 1,000 | 1.00 / **1.00** / 1.00 | 26 / **31** / 63 / 180 |
| sequence | 250 / **611** / 1,000 | 0.73 / **1.00** / 1.00 | 31 / **31** / 625 / 1,508 |

Read the sustain column first: **leads, basses, chords and sequences run sustain at 1.0** (59%,
51%, 79%, 67% exactly at 1.0), which makes their decay stage inert — the 871 ms lead decay median
is a *don't-care*, not a design choice. **Plucks are the one transient role that genuinely uses
D/S/R**: sustain median 0.011, decay 867 ms, release 643 ms. That is the pluck idiom in one line —
**instant attack, sustain at zero, and a long decay/release doing all the shaping**, which is the
opposite of `factory.json`'s plucks (decay 235 ms, release 100 ms, sustain 0.05: same idea, ~4×
too short at the tail).

Lead and bass releases cluster hard at 31.25 ms (Surge's default, 34% and 31% of patches exactly
there) — a professional lead does *not* have a long amp release; the tail comes from the delay and
reverb sends (66.5% of leads carry a delay), not from the envelope.

### 3.3 Attack shape and the defaults finding

`attack_shape` selects the ramp curve: 0 = `sqrt(phase)` (convex, front-loaded), 1 = linear,
2 = `phase²` (concave, back-loaded). All three reach 1.0 at the same 2^raw seconds.

| role | shape 0 (fast) | shape 1 (linear) | shape 2 (slow) |
|---|---|---|---|
| lead | 6% | **86%** | 8% |
| pluck | 9% | **80%** | 11% |
| pad | 11% | **85%** | 4% |
| bass | 7% | **88%** | 5% |
| keys | 15% | **81%** | 4% |
| chords | 4% | **57%** | 39% |

The linear default dominates everywhere, so **the 3.91 ms number is not hiding a curve that makes it
effectively faster or slower.** (Chords are the exception at 39% concave — with n = 28, Low.)

% of patches sitting exactly on Surge's INIT default:

| role | attack @ min | decay @ 250 ms | sustain @ 1.0 | release @ 31.25 ms |
|---|---|---|---|---|
| lead | **65.0%** | 21.0% | 59.2% | 33.9% |
| pluck | **65.8%** | 8.5% | 24.8% | 9.8% |
| pad | 13.1% | 29.4% | 60.9% | 7.2% |
| bass | **65.8%** | 28.1% | 51.0% | 31.0% |
| keys | 43.8% | 12.1% | 21.6% | 10.5% |
| sequence | **68.3%** | 24.8% | 66.5% | 34.3% |

This table is the strongest single argument in the doc. On a control they demonstrably *do* move
for pads (13.1% at default) and keys (43.8%), designers of transient roles leave attack alone
two-thirds of the time. **Fast attack is not a stylistic choice in this corpus; it is the baseline
you deviate from.**

### 3.4 The filter EG, and a perceived-attack proxy

The amp EG is only half the front of the sound. The filter EG (median across every role: attack
3.91 ms, decay 250 ms, **sustain 0.000**, release 250 ms) is the classic percussive shape, and it
matters where the filter actually moves:

| role | % with filter envmod ≥ 6 semitones | their FEG attack p25/med/p75 | their FEG decay median |
|---|---|---|---|
| lead | 49% | 3.9 / **4.1** / 29.7 ms | 516 ms |
| pluck | 39% | 3.9 / **3.9** / 3.9 ms | 637 ms |
| bass | 44% | 3.9 / **3.9** / 8.3 ms | 289 ms |
| keys | 31% | 3.9 / **3.9** / 7.6 ms | 1,091 ms |
| pad | 39% | 3.9 / **204.0** / 2,135 ms | 4,054 ms |

Combining them (`max(ampAttack, filterAttack)` where envmod ≥ 6 semitones) gives a proxy for what an
onset-based rise-time measurement would see:

| role | p25 | median | p75 | p90 | %≤12.5 ms | %≤30 ms |
|---|---|---|---|---|---|---|
| lead | 3.91 | **3.92** | 21.28 | 97.2 | 67.0 | 78.1 |
| pluck | 3.91 | **3.91** | 8.77 | 21.7 | 84.6 | 91.0 |
| bass | 3.91 | **3.91** | 11.21 | 45.7 | 77.3 | 85.4 |
| keys | 3.91 | **5.00** | 13.32 | 62.9 | 73.6 | 84.7 |
| pad | 129.4 | **753.2** | 2,043 | 3,881 | 13.8 | 18.2 |

The medians barely move — **the fast-attack finding survives adding the filter envelope**, which is
the obvious way it could have been an artifact. (Medium: the proxy ignores modulation routings and
does not model the filter's actual contribution to measured rise time.)

## 4. Filter: cutoff, resonance, envelope amount, keytrack

The knob value alone is misleading, because Surge's sounding cutoff is knob + keytrack·(note−60) +
envmod·envelope. Both are given.

| role | %filter off | cutoff knob p25/med/p75 (Hz) | effective @EG peak, role-typical note | @EG sustain | keytrack med | resonance p25/med/p75 | envmod p25/med/p75 (semi) |
|---|---|---|---|---|---|---|---|
| lead | 10.9 | 147 / **419** / 1,258 | 481 / **1,499** / 7,676 | **678** | 0.18 | 0.00 / **0.32** / 0.66 | 0 / **11.1** / 40.0 |
| pluck | 15.4 | 131 / **335** / 1,107 | 380 / **1,031** / 4,117 | **431** | 0.50 | 0.00 / **0.17** / 0.48 | 0 / **1.3** / 29.8 |
| pad | 8.8 | 149 / **480** / 1,190 | 358 / **1,102** / 3,627 | **523** | 0.22 | 0.00 / **0.20** / 0.49 | 0 / **0.0** / 32.4 |
| bass | 12.8 | 76 / **203** / 732 | 132 / **576** / 3,044 | **165** | 0.00 | 0.00 / **0.19** / 0.49 | 0 / **5.8** / 41.7 |
| keys | 16.5 | 161 / **475** / 1,103 | 218 / **555** / 4,176 | **502** | 0.00 | 0.00 / **0.09** / 0.40 | 0 / **0.0** / 27.9 |
| chords | 3.6 | 129 / **523** / 3,120 | 453 / **1,497** / 43,514 | **523** | 0.00 | 0.09 / **0.22** / 0.34 | 0 / **19.5** / 65.7 |

Three things to take from this. **(a) The static cutoff knob is low** — a 419 Hz median for leads is
not a dark patch, it is a patch whose brightness is *scheduled*: the median lead's filter swings
from 419 Hz to ~1.5 kHz under its envelope and back to 678 Hz at sustain, with 49% of leads driving
≥ 6 semitones of envmod. **(b) Resonance is bimodal, not centred** — p25 is exactly 0.00 in five of
six roles (a large fraction of patches use no resonance at all) while p75 is 0.4–0.66. Reporting a
"typical resonance" is meaningless; the design decision is *whether* to resonate. **(c) Lowpass
dominates but is not universal**: LP 65.0% of leads, 69.4% of basses, 64.7% of pads; the rest is
"off" (9–16%), effect filters (comb/S&H/allpass, 5–13%), and highpass (5–10%). A second filter is
on in **54–66%** of patches in every pitched role.

*Caveat:* `resonance` here is Surge's own 0…1 knob mapped into each filter model's internal
resonance, **not** a biquad Q. dotbeat's `resonance` field is a `Tone.Filter` Q. The two are not
commensurable, and §7 does not compare them numerically.

## 5. Oscillators, layering, unison

### 5.1 What generates the sound

Active oscillators (level > 0, unmuted), % of patches:

| role | 0 osc | 1 osc | 2 osc | 3 osc | **≥2** | octave split | noise | ring-mod | cross-FM | waveshaper | filter 2 | dual scene |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lead | 3.6 | 41.5 | 35.0 | 19.9 | **54.9** | **37.9** | 15.0 | 9.4 | 27.5 | 53.8 | 61.2 | 7.6 |
| pluck | 11.1 | 44.0 | 30.3 | 14.5 | **44.9** | **29.9** | 10.3 | 9.4 | 21.4 | 34.6 | 54.3 | 16.2 |
| pad | 7.4 | 36.0 | 30.5 | 26.0 | **56.6** | **38.7** | 10.7 | 11.9 | 28.6 | 31.7 | 65.6 | 16.5 |
| bass | 2.8 | 40.5 | 35.8 | 20.9 | **56.7** | **37.7** | 13.4 | 7.9 | 29.8 | 62.8 | 56.1 | 11.7 |
| keys | 13.0 | 35.2 | 28.6 | 23.2 | **51.7** | **35.9** | 11.1 | 13.0 | 30.5 | 39.0 | 61.9 | 21.6 |
| chords | 0 | 14.3 | 14.3 | 71.4 | **85.7** | **78.6** | 14.3 | 3.6 | 17.9 | 14.3 | 25.0 | 21.4 |
| atmos | — | 12.8 | 32.1 | 38.8 | **70.9** | **54.6** | 9.7 | 31.1 | 60.2 | 42.9 | 91.3 | 20.9 |

Oscillator model, % of patches using ≥1: lead — Classic 57%, Wavetable 32%, Sine 17%; pad —
Wavetable 44%, Classic 43%; bass — Classic 45%, Wavetable 29%, Sine 21%, FM2 10%; keys — Wavetable
37%, Classic 23%, Sine 19%, FM2 14%. **The professional lead is a virtual-analog saw/pulse more
often than anything else, but a third of them are wavetable.**

The "0 active oscillator" rows (2.8–13.0%) are patches whose audible source is the noise generator,
the ring-mod bus, or a mixer level brought up by the mod matrix — see §9.

### 5.2 The supersaw answer

Voice-count histogram across all 1,450 patches with unison on (max across active oscillators):

| voices | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10–15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|
| patches | **404** | **272** | 157 | 102 | 89 | **126** | 72 | 41 | 87 | **100** |

Detune (± half-spread, cents), pooled across roles:

| stack size | n | p10 | p25 | **median** | p75 | p90 | p95 |
|---|---|---|---|---|---|---|---|
| ≥2 voices | 2,020 | 1.2 | 5.4 | **10.0** | 20.0 | 32.8 | 44.2 |
| ≥3 voices | 1,426 | 2.0 | 6.0 | **11.4** | 20.0 | 35.9 | 47.3 |
| ≥5 voices | 810 | 3.1 | 6.5 | **13.5** | 22.9 | 39.0 | 50.3 |
| ≥7 voices | 520 | 3.3 | 7.7 | **13.5** | 23.4 | 41.3 | 60.2 |

And by exact voice count (pooled), the values designers actually dial: 3 voices → 10.0 ¢, 4 → 11.1,
5 → 9.3, 6 → 20.0, 7 → 10.0, 8 → 19.3, 16 → 16.1. **There is a strong preference for round numbers
(10 and 20 cents are modal) and essentially no relationship between stack size and detune** — wider
stacks are not more detuned, contrary to the usual tutorial advice. Detune grows only weakly at the
tail (p90 rises 23.8 → 41.3 from 2 to 7 voices).

Per role, ≥5 voices: pluck **20.0 ¢** (n = 61), polysynth **20.0** (75), pad **17.7** (149), bass
**16.6** (76), sequence **15.3** (60), lead **10.0** (132), keys **10.0** (52). Leads run the
*narrowest* detune of the big roles, which is the opposite of the "detune the lead hard" folk rule.

**Settling the tutorial disagreement:** on this corpus (≥3-voice stacks, n = 1,426), ±7 ¢ sits at
**p27**, ±10 ¢ at **p37**, ±20 ¢ at **p68**, ±30 ¢ at **p87**, and ±61 ¢ at **p97** — so ±10–20 ¢ is
the interquartile heart and ±61 ¢ is a legitimate but extreme choice that ~1 patch in 33 makes. A
generator should sample ±5…25 ¢ for the body and reserve ±40–60 ¢ for a deliberate "wide" variant.

### 5.3 Layering within a patch

Layering is the majority idiom in every pitched role except plucks (44.9%), and **the dominant form
is the octave split**: of the 246 lead patches with ≥2 oscillators, 170 (37.9% of all leads) put
them at different octaves. Chords are extreme — 85.7% multi-oscillator and **78.6% octave-split**,
with 50% carrying a layer a full octave or more below the top. Ring-mod and cross-FM are minority
but non-trivial (9–13% and 21–31%), and 31–63% of patches run the waveshaper, which in the mixer
signal path is functionally another layer of harmonics.

The practical translation into our field names: a professional lead is roughly `osc + osc2 at ±12
semitones + (half the time) sub or a third oscillator + waveshaper/drive + second filter`, not
`osc + cutoff + envelope`.

## 6. Effects

% of patches using ≥1 slot of each type (whole corpus, n = 3,559):

| effect | % | effect | % | effect | % |
|---|---|---|---|---|---|
| delay | **50.0** | reverb (Reverb1) | **38.5** | EQ | **34.4** |
| conditioner | 20.3 | airwindows | 20.0 | reverb2 | 19.9 |
| chorus | 16.6 | distortion | 12.1 | phaser | 7.5 |
| flanger | 7.0 | freq shift | 5.3 | graphic EQ | 4.2 |
| rotary | 4.2 | nimbus | 3.7 | resonator | 3.1 |

Slots used: median **2**, p75 4, p90 6, max 14; **only 9.5% of patches use no effects at all.**

Per role (median slots; top types):

| role | slots | top effects |
|---|---|---|
| lead | 2 | delay **66.5%**, reverb 35.0, EQ 27.0, conditioner 16.1, reverb2 13.4, distortion 12.9 |
| pluck | 2 | delay **70.9%**, reverb 40.2, EQ 38.5, conditioner 25.2, airwindows 20.1 |
| pad | 3 | delay 60.9, reverb 40.1, EQ 34.6, reverb2 25.3, airwindows 24.8, chorus 19.6 |
| bass | 2 | **EQ 34.2**, delay 26.3, conditioner 24.7, **distortion 22.7**, reverb 20.2 |
| keys | 3 | reverb 45.1, delay 43.2, EQ 38.1, reverb2 31.1, chorus 25.4 |
| sequence | 3 | delay **75.7%**, reverb 41.3, conditioner 25.7, chorus 23.0 |
| atmos | 4 | delay 74.0, reverb 61.7, EQ 39.8, reverb2 39.3, chorus 32.7, flanger 30.6 |
| drum | 3 | EQ 53.8, airwindows 39.9, reverb 38.5, distortion 26.6 |

Bass is the one role where **delay is not the top effect** and distortion is near the top — the
role-specific FX prior 131 §7 asked for is right here: *lead/pluck/sequence = delay-first,
bass = EQ+drive-first, pad/keys = reverb-and-chorus-first.* Bass is also the least-processed role
(18.8% with no effects at all, vs 4.8% of pads).

## 7. dotbeat's banks against the professional distribution

### 7.1 The per-parameter gap

`ratio` = our median ÷ Surge median; `pctile` = where our median falls in the role's Surge
distribution.

| bank | role | param | n | our med (p25–p75) | Surge med (p25–p75) | ratio | pctile |
|---|---|---|---|---|---|---|---|
| engine-curated | lead | **attack ms** | 17 | **13** (10–30) | **4** (4–10) | **3.33×** | **p81** |
| engine-curated | lead | decay ms | 17 | 176 (39–440) | 871 (250–1,000) | 0.20× | p15 |
| engine-curated | lead | sustain | 17 | 0.67 (0.52–0.84) | 1.00 (0.66–1.00) | 0.67× | p26 |
| engine-curated | lead | **release ms** | 17 | **1,213** (856–1,466) | **31** (31–332) | **38.8×** | **p91** |
| engine-curated | lead | cutoff Hz | 17 | 1,172 (947–1,406) | 419 (147–1,258) | 2.79× | p73 |
| engine-curated | lead | **osc count** | 17 | **1.0** (1–1) | **2.0** (1–2) | 0.50× | — |
| engine-curated | chords | **attack ms** | 48 | **34** (11–178) | **5** (4–6) | **6.94×** | **p89** |
| engine-curated | chords | **release ms** | 48 | **862** (480–1,404) | **31** (26–63) | **27.6×** | **p100** |
| engine-curated | chords | **osc count** | 48 | **1.0** | **3.0** (2–3) | 0.33× | — |
| engine-curated | bass | **attack ms** | 112 | **20** (6–274) | **4** (4–8) | **5.25×** | **p88** |
| engine-curated | bass | **release ms** | 112 | **642** (198–1,107) | **39** (31–248) | **16.6×** | **p89** |
| engine-curated | bass | decay ms | 113 | 121 (51–466) | 621 (250–1,080) | 0.19× | p7 |
| engine-curated | bass | cutoff Hz | 116 | 700 (460–1,234) | 203 (76–732) | 3.45× | p74 |
| factory.json | lead | attack ms | 4 | 2 (2–7) | 4 (4–10) | 0.64× | p0 |
| factory.json | lead | **cutoff Hz** | 5 | **6,500** (5,200–7,000) | **419** (147–1,258) | **15.5×** | **p93** |
| factory.json | pluck | **cutoff Hz** | 4 | **3,600** (2,100–5,250) | **335** (131–1,107) | **10.8×** | **p89** |
| factory.json | pluck | release ms | 4 | 100 (95–112) | 643 (180–1,505) | 0.16× | p20 |
| factory.json | keys | **cutoff Hz** | 4 | **5,250** (4,025–6,500) | **475** (161–1,103) | **11.1×** | **p93** |
| factory.json | pad | attack ms | 5 | 500 (400–600) | 541 (70–1,405) | 0.92× | p48 |
| factory.json | pad | release ms | 5 | 1,500 (1,200–1,800) | 1,803 (611–3,000) | 0.83× | p45 |
| factory.json | pad | cutoff Hz | 5 | 2,600 (1,400–3,200) | 480 (149–1,190) | 5.42× | p87 |

Four patterns, in order of size:

1. **Release is our largest deviation, by an order of magnitude** — 16–39× on every
   engine-curated role. A 1.2 s amp release on a lead is not a stylistic difference; it means every
   note bleeds into the next, which is exactly the "static, undifferentiated" failure 131 §3.2
   describes and the direct opposite of `attackCv` (attack-time *variety*) being a top
   discriminator.
2. **Attack is 3–7× slow** — a smaller ratio but the one 131 identified as directly predictive.
3. **We are single-voice everywhere.** 180 of 181 engine-curated presets have `unisonVoices = 1`,
   176 have `osc2Level = 0`, 180 have `subLevel = 0`, 181 have `noiseLevel = 0`, 175 have
   `filterEnvAmount = 0`. Against a corpus where 51–57% of patches in every pitched role are
   multi-oscillator and 27–48% run unison ≥ 3.
4. **The cutoff comparison is not "we are too bright" — it is "we are static."** Our leads at
   1,172 Hz sit between Surge's lead knob median (419 Hz) and its envelope-peak median (1,499 Hz).
   Professionals get 419 → 1,499 → 678 Hz *within a note*; we get 1,172 Hz forever. `factory.json`
   at 5,200–7,000 Hz is a different problem — genuinely brighter than any point in the professional
   swing.

`factory.json`'s `osc2Detune` also splits into two clearly different intents that our schema
conflates: the leads/pads/plucks use 5–19 cents (unison-range, right in the professional band),
while `bass` uses 1,203 ¢ and `keys` 1,907 ¢ — i.e. octave/interval layering. Both are legitimate;
they should be separate parameters or at least separately sampled, because a generator that samples
`osc2Detune` uniformly will produce neither.

### 7.2 Why: the roll generator's prior

`scripts/curate-engine-presets.mjs:rollParams()` emits exactly eight keys — `osc`, `volume`,
`cutoff`, `resonance`, `attack`, `decay`, `sustain`, `release` — against a format surface of
**9 core + 136 optional fields**. Nothing that this doc measures as load-bearing (osc2, sub, noise,
unison, filter envelope, waveshaping, a second filter, effects) is ever rolled. And the attack prior
is `rlog(0.002, 0.8)` — log-uniform over 2 ms…800 ms, whose median is **40 ms** and which puts only
**30.6%** of its mass below 12.5 ms and 18.3% below 6 ms. The critic pulled the survivors down from 40 ms to 13 ms; it could
not pull them to 4 ms because a log-uniform prior over three decades barely samples the floor. **The
prior, not the critic, set the attack distribution.**

### 7.3 The Surge arm's own two bugs

- **The draw pool is 18% of what is installed.** `python/surge_render.py:_patches_root()` resolves
  `<factory>/patches_factory` and nothing else, so `beat surge patches` enumerates 639 of 3,559.
  Never drawn: 317 additional leads, 377 basses, 354 pads, 299 keys, 123 plucks by named designers.
- **`chords` never draws from Surge's chord patches.** `SURGE_ROLE_CATEGORIES.chords =
  ['Pads','Keys']` (`src/taste/showdown.ts:845`) and all 16 curated chords picks are from `Pads`,
  attack median 810 ms — statistically indistinguishable from the Pads pool itself (p48), so this is
  a mapping problem, not a curation problem. Surge's `Chords` (28 patches, attack median 4.83 ms,
  85.7% multi-oscillator, 78.6% octave-split) and `Polysynths` (189, attack median 3.91 ms) are
  never eligible. Against 131's chords targets (`attackMedMs ≤ 12 ms`, onset rate ≥ 4/s), the arm is
  drawing from precisely the wrong shelf.

## 8. What this data licenses (targets, stated as bands)

Not "set X" — every one of these is a band with a stated coverage, which is what a verification gate
can check and a maximizer cannot Goodhart (139 §1).

| role | amp attack | amp release | sustain | osc count | unison | filter |
|---|---|---|---|---|---|---|
| lead | **≤ 12 ms** (80% of corpus); ≤ 6 ms for the modal case | **≤ 330 ms** (75%); 31 ms is modal | 0.66–1.0 | ≥ 2 for 55% | 3–7 voices at ±5–25 ¢ when on (46% on) | LP, envmod ≥ 6 semi for half |
| pluck | **≤ 12 ms** (88%) | 180–1,500 ms (IQR) | **≤ 0.05** | 1–2 | ±8–27 ¢, 6 voices modal when on | LP, low resonance |
| bass | **≤ 12 ms** (83%) | **≤ 250 ms** (75%) | 0.33–1.0 | ≥ 2 for 57% | ±5–20 ¢ (45% on) | LP, cutoff knob 76–732 Hz, waveshaper 63% |
| keys | **≤ 12 ms** (78%) | 77–1,533 ms | 0.0–0.84 | ≥ 2 for 52% | ±3–11 ¢ | LP, low resonance, reverb-first FX |
| pad | **70–1,400 ms** (IQR), median 541 | **600–3,000 ms** | 0.68–1.0 | ≥ 2 for 57% | **48% at ≥3 voices**, ±8–20 ¢ | LP, filter 2 on 66% |
| chords | ≤ 12 ms (86%) | ≤ 63 ms (75%) | 1.0 | **≥ 2 for 86%, ≥ 3 for 71%** | ±9–19 ¢ | LP, envmod median 19.5 semi |

The three cheapest fixes implied, ordered by measured distance: **(1)** clamp/retarget release —
we are 16–39× out and it costs one line in the roll prior; **(2)** change the attack prior from
log-uniform[2 ms, 800 ms] to something with ≥ 60% of mass below 12 ms for transient roles; **(3)**
turn on a second oscillator at an octave for half of rolls, which no current roll ever does.

## 9. Honest gaps

- **Static values only.** Every number is the stored knob. LFO, velocity, macro, mod-wheel and
  mod-matrix routings to these same parameters are not resolved. Surge patches use these heavily
  (`modrouting` elements appear throughout), so a patch's *sounding* cutoff, level or even envelope
  time can differ from what is reported. This is the single largest unquantified error source, and
  it is the reason 2.8–13.0% of patches per role read as having zero active oscillators (their
  mixer levels are modulation-driven, or the source is the noise/ring bus — 9 of 16 such leads have
  audible noise). **Fixing this is a well-defined follow-up**: `getAllModRoutings()` is exposed in
  surgepy and the depths are in the XML.
- **Scene B is unmeasured** for the 554 dual and 45 split patches (16.8%), highest in sequences
  (35.2%) and keys (21.6%). Those patches' second layer is invisible here, so §5.3's layering
  percentages are **understated**.
- **Roles are directory labels.** No listening was done. Mislabeled patches widen distributions.
- **The 3.906 ms floor is a Surge artifact.** It is the smallest ramp Surge's `ct_envtime` can
  express. A synth with a smaller minimum might show designers going lower; we cannot know from
  this corpus. Read "3.91 ms" as "the designer asked for the fastest available."
- **Resonance is not comparable across engines.** Surge's 0…1 knob and dotbeat's `Tone.Filter` Q are
  different quantities; §7 deliberately omits the resonance row.
- **The effect percentages are per-slot presence, not per-slot audibility.** A patch with a delay in
  a bypassed slot or at 0% mix counts as using delay. `fx_bypass` and `fx_disable` are recorded in
  the JSONL but not applied to the reported percentages.
- **n = 28 for chords, 31 for vox, 39–52 for guitar/bell.** Treat those rows as Low/Medium.
- **Not an audio measurement.** This doc says what designers *set*; 131 says what a listener
  *measures*. The bridge between them (§3.4's proxy) is unvalidated — the honest next step is to
  render ~200 of these patches through the existing sidecar and measure their actual 10→90% rise
  times against the stored attack, which would calibrate the two scales against each other and
  turn "ask for zero" into a real number for our engine.

## Artifact and reproduction

- **`presets/role-parameter-stats.json`** (uncommitted) — 18 roles × {ampEnv, filterEnv,
  perceivedAttackProxy, filter, oscillators, unison, voicing, effects}, each as
  n/min/p10/p25/median/p75/p90/max plus the categorical percentages, with the provenance discipline
  of `presets/engine-curated.json`: `version`, `generatedAt`, `note`, a `corpus` block (source,
  `$SURGE_DATA_HOME`, Surge build hash, patch counts by pool, role-source rule, scene rule, the full
  role mapping, excluded categories), a `conversions` block (every formula + the surgepy
  verification tallies), and a `caveats` array carrying §9's limits into the machine artifact so a
  consumer cannot silently over-trust it. Also carries
  `pooledUnisonDetuneCentsByVoiceCount` for the supersaw question.
- **Scratch pipeline** (outside the repo): `~/.claude/jobs/fc3bd856/tmp/presetmine/` —
  `extract.py` (fxp → `patches.jsonl`, 3,559 rows, ~3 s), `verify.py` (surgepy cross-check),
  `analyze.py` / `analyze2.py` (role distributions), `compare2.py` (bank comparison),
  `final.py` (the artifact). `verify.py` needs `python3.14` and
  `SURGE_DATA_HOME=tools/surge/resources/data`.

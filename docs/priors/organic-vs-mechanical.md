# Organic vs. mechanical: why a layered stack reads as "buzzy/saw-y" instead of "lush"

Vein: the perceptual gap named by the owner on 2026-07-26 after listening to nine layered clips:

> "overall, I would say this layered approach makes everything seem sort of buzzy/drive-y/saw-y more
> mechanical sounding"
>
> "it just sounds a bit saw-toothy... Like almost mechanical/electronic... less lush and organic like
> I'd like chords"

Sibling of `docs/priors/layering.md` (architecture) and `docs/priors/layering-by-genre.md`
(genre/role variation). This file is about *character*, not *structure*: given a stack that is
correctly balanced and correctly crossed over, what makes it sound like a machine and what makes it
sound like an instrument.

Confidence markers follow `docs/priors/README.md`: **[CONSENSUS]** (3+ unrelated sources),
**[CORROBORATED]** (2 sources), **[SINGLE SOURCE]** (one source — a hypothesis, not a spec),
**[MEASURED]** (counted from a local corpus in this repo, not a prose source — the strongest kind of
claim here, and traceable by re-running the stated command).

---

## 0. The one-paragraph answer

Four independent lines of evidence point at the same thing, and none of them is "the layer
architecture is wrong". They are: (a) odd-order harmonic distortion is the documented signature of
"rough, harsh, gritty, edgy" and symmetric drive on a saw produces exactly that (§1); (b) in a
corpus of 3,559 professionally designed patches, waveshaping is a **62.8%** move on bass and a
**14.3%** move on chords — dotbeat drives every layer the same way (§4); (c) the same corpus puts
the median pad/chord filter cutoff at **480–523 Hz**, i.e. professional pads are *dark*, and
unison is a *minority* choice in every role (§4); and (d) dotbeat's unison is a fixed, symmetric,
equal-spaced detune ladder whose oscillator phase is hard-reset on every note-on, which is the
maximally-coherent, maximally-repeatable construction available (§5). The complaint words
"buzzy / drive-y / saw-y / mechanical" map one-to-one onto those four.

---

## 1. Even vs. odd harmonics — the sourced explanation for "buzzy" and "drive-y"

**[SINGLE SOURCE, but a primary-authority one, and the sharpest causal claim in this file]**
Sound On Sound's *Analogue Warmth* feature states the distinction outright:

> "Even-order harmonic distortion tends to sound musically sympathetic, smooth, and bright"
>
> "Odd-order harmonic distortion tends to sound rough or harsh, gritty or edgy."

Source: https://www.soundonsound.com/techniques/analogue-warmth

Why this lands on dotbeat specifically: a **symmetric** transfer curve (hard clip, `tanh`, and most
naive waveshapers) generates **only odd harmonics**. An **asymmetric** curve (single-ended tube,
transformer, tape) generates even harmonics too. So "add saturation to make it richer" applied with
a symmetric shaper is, per this source, a documented recipe for "rough, harsh, gritty, edgy" — the
owner's "drive-y" — not for warmth. This is the single most directly actionable claim in this file
and it is currently **[SINGLE SOURCE]**; a second independent source stating the even/odd split
would upgrade it and is worth one follow-up fetch.

**Actionable in this codebase**: `saturatorCurve` in `src/core/document.ts` is already an enum. The
claim above says the *choice of curve* is the warm/harsh axis, not the drive amount. Which of
dotbeat's curves are symmetric has not been checked and should be, before any tuning of
`saturatorDrive`.

### Tape's own numbers, for the "analogue" moves that are not distortion

**[SINGLE SOURCE]** Same SOS article, giving the modulation bands by name and rate:

| Phenomenon | Rate |
|---|---|
| drift | below **0.1 Hz** |
| wow | **0.1–10 Hz** |
| flutter | **10–100 Hz** |
| scrape flutter | **1–5 kHz** region |

and a depth reference point: the Studer A820 two-track's quoted wow-and-flutter figure was
**0.04%** at 15 ips — i.e. a *professional* machine's pitch instability is four hundredths of a
percent (≈0.7 cents), not the several-percent wobble a "tape" plugin usually offers. Also from the
same source: professional tape bias is **75–150 kHz**, and transformer distortion at a −75 dBu
signal level ranged from **1%** to **60%** between two designs — the point being that "analogue
character" is not one number, it spans nearly two orders of magnitude across real gear.

Source: https://www.soundonsound.com/techniques/analogue-warmth

**Actionable**: dotbeat has `lfoRate` in Hz and `pingPongWobbleRate`/`pingPongWobbleDepth`. The
drift band (**<0.1 Hz**) is the one nothing in the engine currently occupies — every LFO default is
orders of magnitude faster. A per-layer pitch LFO at **0.02–0.08 Hz** and a depth on the order of
**1 cent** is the sourced "drift" setting, and it is deliberately slower than anything that reads as
vibrato.

---

## 2. Width without detune: PWM and non-periodic modulation

**[SINGLE SOURCE]** Sound On Sound's Synth Secrets string-machine instalment makes a mechanism claim
that matters because it is a route to width that does **not** add more detuned saws:

> "Pulse waves whose widths are modulated by triangle waves have another, rarely appreciated
> characteristic; they exhibit pitch modulation that oscillates at the PWM rate above and below the
> true oscillator pitch."

i.e. **PWM is a chorus** — it produces the same above/below-pitch beating that detuning produces,
from a *single* oscillator, with no extra harmonic content added. The same article specifies
**sample & hold fed from a noise source** applied to oscillator pitch explicitly to get "no periodic
modulation" — random drift rather than a regular vibrato wobble.

Source: https://www.soundonsound.com/techniques/synthesizing-strings-string-machines

This corroborates the existing `docs/priors/chords-pads.md` Recipe 9, which mined the same article,
and it is the clearest documented alternative to "add another detuned saw" for width.

**Not reachable in this codebase, stated**: dotbeat's oscillator set has no pulse-width parameter
and no PWM destination in `LfoDestination` (`src/core/document.ts`). The `wtTable: 'pwm'` wavetable
exists but wavetable position is not the same control. This is a real capability gap, not a tuning
miss — flag it rather than substituting more detune for it.

---

## 3. The primary source on the supersaw is currently unreachable

The single best source for "why does a real supersaw not sound like seven equally-detuned saws" is
Adam Szabo's 2010 KTH thesis *How to Emulate the Super Saw*, which reverse-engineers the JP-8000
oscillator including its detune curve and side-oscillator mix law. **All three known URLs are dead
or blocked from this tool** (recorded so the next pass does not repeat the attempt):

- http://www.adamszabo.com/internet/adam_szabo_thesis.pdf — **404** (301s to https, then 404)
- https://www.nada.kth.se/utbildning/grukth/exjobb/rapportlistor/2010/rapporter10/szabo_adam_10131.pdf
  — **dead**, KTH returns a "NADA site no longer exists" notice
- the archive.org mirror — **WebFetch cannot reach web.archive.org at all** ("Claude Code is unable
  to fetch from web.archive.org")

What we do have, second-hand: Wikipedia's supersaw article describes the JP-8000 oscillator as
"a **free-run** oscillator whose shape resembles **7 sawtooth oscillators** detuned against each
other," and cites both Szabo (2010) and Alex Shore's 2013 "An Analysis of Roland's Super Saw
Oscillator and its Relation to Pads within Trance Music."
Source: https://en.wikipedia.org/wiki/Supersaw

**[SINGLE SOURCE]** The load-bearing word is **free-run**: the canonical supersaw's constituent
oscillators are *not* re-phased at note-on. See §5 for why that matters here.

**What would close this gap**: any mirror of the Szabo PDF, or Alex Shore's 2013 paper. Both give
the actual detune spacing law. Until then, "the real supersaw's detune spacing is non-uniform" is a
widely-repeated claim this repo cannot cite, and it should not be written into any prior as fact.

---

## 4. [MEASURED] What 3,559 professional patches actually do, per role

Counted from `presets/role-parameter-stats.json` (research/141 — Surge XT factory + bundled
third-party banks; role labels are the patch authors' own directory names). Reproduce with
`python3 -c` over that file. These are **[MEASURED]** claims: they record what designers did, not
what tutorials say, and where they disagree with a tutorial the corpus should win.

### 4a. Unison is a minority choice in every role — including leads

| role | n | % using unison at all | % ≥3 voices | % ≥7 voices | median voices when on |
|---|---|---|---|---|---|
| bass | 494 | **44.5%** | 27.1% | 7.9% | 3 |
| lead | 448 | **46.4%** | 29.5% | **13.6%** | 3 |
| pluck | 234 | 33.3% | 28.2% | 13.2% | 6 |
| pad | 419 | **61.8%** | 48.2% | 19.6% | 4 |
| chords | 28 | 50.0% | 42.9% | 7.1% | 3 |
| keys | 315 | 39.4% | 27.0% | 8.9% | 3.5 |
| polysynth | 189 | 54.0% | 45.0% | 20.6% | 5 |
| strings | 65 | **18.5%** | 15.4% | 10.8% | 7.5 |
| organ | 40 | 32.5% | 25.0% | 7.5% | 4 |
| bell | 52 | 21.2% | 11.5% | 7.7% | 3 |

**This directly contradicts `docs/priors/layering.md` §3**, which records "7–9 voice unison" as the
**[CONSENSUS]** lead architecture across MusicTech/Syntorial/KVR/FaderPro. Measured, **13.6%** of
lead patches use 7 or more unison voices and **53.6%** use none at all. Both facts can be true —
tutorials teach the *genre-signature* trance supersaw, the corpus contains every lead ever made —
but the prior currently presents a 14% minority construction as the default architecture, and
dotbeat builds from the prior. Recorded as a contradiction, not resolved by picking a side.

**What would settle it**: the same count restricted to patches whose author-directory or name marks
them trance/EDM. The corpus has the directory metadata; the stats file does not preserve it.

### 4b. Detune magnitude does differ by role — but by less than an octave of range

Median unison detune (Surge's ± half-spread convention), patches with unison on:

| role | median cents | p90 cents |
|---|---|---|
| pluck | **19.2** | 40.8 |
| polysynth | 15.0 | 29.0 |
| pad | 12.2 | **26.9** |
| chords | 12.1 | 21.6 |
| strings | 10.6 | 19.0 |
| bass | 10.0 | 33.3 |
| lead | 10.0 | **41.2** |
| organ | 9.5 | 15.8 |
| keys | 8.5 | 20.0 |
| bell | 8.1 | 11.0 |

Two readings, both relevant to the complaint:

1. **Medians are close** (8–19 cents across ten roles) — so "detune amount" is *not* the main axis
   separating a lush pad from a buzzy lead. The prior's ±10 cents (Hyperbits) is well-calibrated as
   a central value and the corpus median for bass and lead is exactly **10.0**.
2. **The tails are not close.** Lead p90 = **41.2** cents, pad p90 = **26.9**, chords p90 = **21.6**,
   bell p90 = **11.0**. Leads are allowed to go twice as far out as chords. A single sweep range
   shared across roles will, at its top end, give chords a lead's detune — which is the "saw-toothy"
   complaint in one number.

### 4c. Waveshaping is a bass/lead move, not a chords/pads move

| role | % of patches using a waveshaper | % using FM | % with a noise layer |
|---|---|---|---|
| bass | **62.8%** | 29.8% | 13.4% |
| lead | **53.8%** | 27.5% | 15.0% |
| organ | 50.0% | 22.5% | **27.5%** |
| strings | 44.6% | 16.9% | 13.8% |
| polysynth | 42.9% | 13.2% | 18.5% |
| keys | 39.0% | 30.5% | 11.1% |
| pluck | 34.6% | 21.4% | 10.3% |
| pad | **31.7%** | 28.6% | 10.7% |
| chords | **14.3%** | 17.9% | 14.3% |

Bass patches are **4.4×** as likely to be waveshaped as chord patches. This is the cleanest
"not one size fits all" number in the file, and it maps exactly onto the owner's word **drive-y**:
whatever drive setting is right for a bass growl layer is, per the corpus, a move that 85.7% of
chord patches decline to make.

**Actionable in this codebase**: `saturatorDrive`/`saturatorMix` and the per-layer
`production.profile.saturator` in `src/taste/layered.ts` are applied on the same footing for every
role. The corpus says role should gate drive, not just scale it.

### 4d. Professional pads and chords are DARK

Median filter cutoff (knob value; sounding cutoff also includes keytrack and envmod, reported
separately in the source file):

| role | median cutoff | % lowpass |
|---|---|---|
| bass | **203 Hz** | 69.4% |
| polysynth | 319 Hz | 67.2% |
| pluck | 335 Hz | 59.4% |
| lead | 419 Hz | 65.0% |
| keys | 475 Hz | 55.2% |
| pad | **480 Hz** | 64.7% |
| strings | 503 Hz | 60.0% |
| chords | **523 Hz** | 82.1% |
| organ | 523 Hz | 60.0% |
| bell | 1442 Hz | 25.0% |

A median chord patch is lowpassed at **523 Hz** and is lowpass-filtered in **82.1%** of cases — the
highest lowpass rate of any role measured. "Lush chords" in the corpus are, overwhelmingly, *filtered
saws*, not raw ones. An unfiltered or lightly-filtered saw stack is not a mild deviation from
practice; it is outside the middle of the distribution for the role by a wide margin.

Note the caveat the source file states for itself: these are **static knob values**; LFO / velocity /
macro / mod-matrix routings are not resolved, so a patch's sounding cutoff can differ from the stored
value. Treat the medians as the resting point of the filter, which is the relevant number for a
sustained chord anyway.

### 4e. Chords are the most oscillator-dense and most octave-split role

| role | % using 3 oscillators | % with an octave split between oscillators |
|---|---|---|
| chords (n=28) | **71.4%** | **78.6%** |
| organ | 35.0% | 50.0% |
| pad | 26.0% | 38.7% |
| keys | 23.2% | 35.9% |
| strings | 23.1% | 13.8% |
| bass | 20.9% | 37.7% |
| lead | 19.9% | 37.9% |
| pluck | 14.5% | 29.9% |
| polysynth | 10.1% | 27.5% |

**[MEASURED, small n]** With only 28 chord patches this is the weakest row in the table and must not
be over-read. But its direction agrees with `docs/priors/chords-pads.md` Recipe 15 (ensemble
voicing across registers) and with the "low- and high-octave doublings" rule mined from Attack's
techno-pads piece: for chords specifically, **octave doubling — not unison detune — is the
documented thickening move.** That is a different mechanism from the one dotbeat currently reaches
for, and it adds no extra harmonic density in the 1–4 kHz band where "buzzy" lives.

### 4f. Effects usage is role-specific, and chords/keys are the chorus roles

Median FX slots used, and the top types by usage rate:

| role | median FX slots | top effect types |
|---|---|---|
| bass | 2 | eq 34.2%, delay 26.3%, conditioner 24.7%, distortion **22.7%**, reverb1 20.2% |
| lead | 2 | **delay 66.5%**, reverb1 35.0%, eq 27.0% |
| pluck | 2 | **delay 70.9%**, reverb1 40.2%, eq 38.5% |
| polysynth | 2 | **delay 75.1%**, reverb1 38.1%, eq 32.8%, chorus 16.4% |
| pad | 3 | delay 60.9%, reverb1 40.1%, eq 34.6%, reverb2 25.3%, **chorus 19.6%** |
| chords | 2 | **reverb1 42.9%**, delay 35.7%, **chorus 32.1%** |
| keys | 3 | **reverb1 45.1%**, delay 43.2%, eq 38.1%, reverb2 31.1%, **chorus 25.4%** |
| strings | **4** | eq 53.8%, reverb1 46.2%, **reverb2 46.2%**, conditioner 35.4% |
| organ | 2 | **rotary 45.0%** |
| bell | 2 | reverb2 46.2%, reverb1 44.2%, eq 42.3% |

Three findings:

1. **Chords and keys are reverb-first; leads, plucks and polysynths are delay-first.** The gap is
   large (chords: reverb 42.9% > delay 35.7%; polysynth: delay 75.1% > reverb 38.1%).
2. **Chorus is a chords/keys effect**: **32.1%** on chords and **25.4%** on keys, versus 16.4% on
   polysynth and absent from the bass and lead top-six entirely. This corroborates
   `docs/priors/chords-pads.md`'s cross-source consensus #4 ("chorus + reverb is the default pad
   finishing chain") with a measured usage rate, and it is a *width* mechanism that adds no
   harmonics — see §2.
3. **Strings — the role a listener would call the most "organic" — uses the MOST processing**
   (median **4** FX slots, both reverbs at ~46%) and the **least** unison (18.5%, §4a), and reaches
   for a physical-model `String` oscillator in **29.2%** of patches. Organic is not achieved by
   stacking more voices; in this corpus it correlates with *fewer* voices and *more* space.

---

## 5. [CODEBASE OBSERVATION, not a sourced claim] dotbeat's unison is the maximally-coherent construction

Read-only inspection of this repo, 2026-07-26. Recorded here because it is the mechanism the sourced
material above predicts would sound mechanical, and because it is falsifiable by reading the same
lines — but **it is an observation about our code, not a claim about producer practice**, and it
carries no source URL by design.

1. **Detune spacing is exactly uniform and exactly symmetric.** `ui/src/audio/engine.ts:4132-4134`
   places unison voices at integer multiples of one shared `osc2Detune` value:
   `freq * 2^(u.mul * osc2Detune / 1200)` with a mirrored `-osc2Detune` partner. Seven voices are
   therefore at −3d, −2d, −d, 0, +d, +2d, +3d for a single d. Every beat frequency in the stack is
   a harmonic of the same fundamental beat rate, so the whole stack pulses in lockstep rather than
   shimmering.
2. **Oscillator phase is hard-reset on every note-on, on every layer.** `src/taste/layered.ts:65-75`
   records this deliberately, having verified that Tone's `Synth._triggerEnvelopeAttack` calls
   `oscillator.start(time)` on every attack, recreating the node at phase 0. Combined with (1), every
   note of every chord starts the identical beating pattern from the identical phase — the stack is
   bit-identically repeatable note to note.
3. **The justification for (2) came from the kick-layering literature.** `layering.md` §2's
   phase-sync finding (Ali Jamieson: hard-sync an oscillator layer to 0° per gate to stop
   inconsistent hit-to-hit volume) is a **percussive, single-shot** result. §3 above records that the
   canonical supersaw is described as **free-run**. These are opposite prescriptions for opposite
   cases, and the repo currently applies the percussive one to sustained pitched layers.

**This is the file's sharpest hypothesis and it is testable inside dotbeat today**: render the same
chord stack twice, once as-is and once with per-voice detune perturbed off the uniform ladder (and,
if reachable, without the per-note phase reset), and put the pair in
`~/Documents/dotbeat/taste-dataset/listen-bench/` as a labeled case. Per CLAUDE.md the roughness
signal only exists BETWEEN matched renders of the same material, so this specific A/B is the only
form of evidence that can confirm or kill it.

---

## 6. What is NOT sourced yet

Listed explicitly rather than written up as fact. Each names the kind of source that would close it.

- **Per-voice random detune amounts.** No source found stating how much random offset to add per
  unison voice (as opposed to how much total detune). Would be closed by: the Szabo thesis (§3), a
  synth manual documenting a "detune randomness"/"analog" knob's range in cents, or u-he Diva/Repro
  documentation.
- **Whether free-running phase is preferred for sustained pitched layers.** §3's "free-run" is one
  encyclopedia sentence. Would be closed by: any synth manual or DSP write-up stating a per-note
  phase-reset policy and its reason.
- **Envelope variation between layers.** The brief asked whether producers deliberately give layers
  different attack/decay so the stack does not move as one block. Nothing found in this pass.
  `docs/priors/chords-pads.md` Recipe 16 has the closest thing — a drive envelope with a **~40 ms**
  attack sitting behind a **0 ms** filter-envelope attack inside *one* patch — but that is
  intra-patch, not between layers.
- **A second source for the even/odd harmonic claim (§1).** Currently [SINGLE SOURCE] and it is the
  most load-bearing claim in the file.
- **Whether any of dotbeat's `saturatorCurve` options are asymmetric.** A code question, not a
  research question; not answered here because this stream may not modify `src/`.

## Sources fetched (successful)
- https://www.soundonsound.com/techniques/analogue-warmth
- https://www.soundonsound.com/techniques/synthesizing-strings-string-machines
- https://en.wikipedia.org/wiki/Supersaw

## Local corpora used
- `presets/role-parameter-stats.json` (research/141) — 3,559 Surge XT patches, 639 factory +
  2,920 third-party.

## Sources attempted but blocked
- http://www.adamszabo.com/internet/adam_szabo_thesis.pdf — 404
- https://www.nada.kth.se/utbildning/grukth/exjobb/rapportlistor/2010/rapporter10/szabo_adam_10131.pdf — dead (site retired)
- web.archive.org — **structurally unreachable** from WebFetch in this harness ("Claude Code is
  unable to fetch from web.archive.org"). Worth recording as a standing limitation, not a one-off.
- https://bassculture.substack.com/p/production-tips-layering-for-richer — paywalled; the visible
  preview contains no numbers (re-checked 2026-07-26, still no)
- https://www.pointblankmusicschool.com/blog/guide-to-layering-drum-samples-for-a-punchier-mix/ — 403 (retried, still 403)
- https://blog.techne.fm/posts/how-to-kick-sound-design-before-mixing/ — 502 (retried, still 502)
- https://api.semanticscholar.org/graph/v1/paper/search — 429

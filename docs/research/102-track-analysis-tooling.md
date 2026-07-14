# Research pass 102 — Track-analysis tooling: stems, structure, beats, chords, melody

*Run 2026-07-14 for Phase 35 Stream OE ("learn from actual tracks"). Manual web pass — searches
plus primary-source fetches (GitHub READMEs, license files, PyPI) — NOT the 3-vote adversarial
harness used for passes 01-09, so confidence is labeled per claim instead: **confirmed** =
primary source fetched directly or 2+ independent sources agree; **single-source** = one source,
plausible, unverified; **inconclusive** = couldn't establish. Infrastructure note: arxiv.org was
403-blocked by the session proxy, so paper-table numbers below come from secondary reporting
(named inline) rather than the papers themselves — treat every such number as single-source even
when the claim's existence is confirmed.*

## Headline

Everything dotbeat needs to "listen to a reference track" exists as permissively-licensed open
source, but almost all of it is Python/PyTorch — the realistic integration shape is a **Python
sidecar invoked as a child process, emitting a JSON analysis artifact that dotbeat caches**
(exactly one exception: Spotify's basic-pitch has a first-class TypeScript/TensorFlow.js npm
package). The licensing minefield is real and specific: **madmom's pretrained models are
CC-BY-NC-SA** (code is BSD), **Essentia is AGPL**, **Chordino/NNLS-chroma is GPL**, **YourMT3 is
GPL-3.0**, and the best-quality separation checkpoints (BS/Mel-RoFormer community weights) are
scattered and often non-commercial — while **Demucs (MIT), Beat This (MIT, explicitly including
weights), allin1 (MIT), basic-pitch (Apache-2.0), BTC (MIT), and crema (BSD-2)** cover every
capability dotbeat actually needs without touching any of them.

## 1. Source separation for local use

**State of the family** *(confirmed — facebookresearch/demucs README fetched)*:
`facebookresearch/demucs` is archived — "this repository is not maintained anymore" — and the
original author's fork (`adefossez/demucs`) also self-describes as not actively maintained. The
code and repo are MIT. Models shipped: `htdemucs` (v4 hybrid transformer, default), `htdemucs_ft`
(fine-tuned, ~4x slower, slightly better), `htdemucs_6s` (adds guitar/piano), `hdemucs_mmi`, plus
older `mdx*` models. Repo-stated quality: **9.00 dB SDR on MUSDB-HQ, 9.20 dB fine-tuned**.
Runtime: **CPU ≈ 1.5× track duration**; GPU needs 3 GB VRAM minimum, 7 GB recommended
(`--segment 8` for smaller). Caveat: the repo is MIT but I did not find a separate explicit
license statement for the downloadable weights; downstream MIT projects (audio-separator,
demucs.cpp) redistribute/wrap them as if MIT *(that last inference is mine — inconclusive as a
verified fact)*.

**Successors** *(mixed)*: BS-RoFormer (ByteDance) won the SDX23 music-separation track and is the
quality frontier — **11.99 dB average SDR on MUSDB18-HQ with 500 extra training songs, 9.80 dB
without extra data** *(single-source: numbers via search-result reporting of the arXiv paper
2309.02612 lineage; arxiv fetch blocked)*. The catch is weights: lucidrains' implementation is
MIT but **architecture-only, no checkpoints** *(confirmed — repo fetched)*. Usable checkpoints
come from the community — ZFTurbo's `Music-Source-Separation-Training` (code MIT, supports
BS/Mel-RoFormer, SCNet, Demucs4HT and more; actively developed, "MVSep Mega 53 Stems" release
April 2026) **states no explicit license for the checkpoints themselves** *(confirmed absent —
repo fetched)*, and at least one HF-hosted Mini-BS-RoFormer-V2 is CC-BY-NC-4.0 *(single-source)*.
Practical read: RoFormer-family weights are a licensing swamp; Demucs htdemucs is the safe local
default and is "good enough for analysis" — dotbeat would use stems to compute per-stem metrics,
not to ship audio.

**Integration reality** *(confirmed — both repos fetched)*:
- `python-audio-separator` (nomadkaraoke): MIT, pip-installable CLI + Python API wrapping
  MDX-Net, VR, Demucs, and MDXC (BS/Mel-RoFormer) model families; CPU-only install supported,
  CUDA/CoreML/DirectML acceleration options; **actively maintained — v0.44.3 released July 2026,
  126 releases**. The most turnkey local option.
- `sevagh/demucs.cpp`: MIT, C++17 + Eigen inference for Demucs v3/v4 including htdemucs_6s, ggml
  weights, has a `src_wasm` directory (WASM builds), designed for low memory at the cost of being
  slower than Torch. Proof that a no-Python path exists if we ever want one, not the recommended
  first path.

## 2. Music structure segmentation

**The one-stop tool** *(confirmed — mir-aidj/all-in-one repo fetched)*: `allin1` (Kim & Nam,
WASPAA 2023, arXiv:2307.16425) predicts **tempo, beats, downbeats, and functional segment
boundaries + labels** (10 classes: start/end/intro/outro/break/bridge/inst/solo/verse/chorus) in
one pass over Demucs-separated stems. **MIT license.** Trained on the Harmonix Set (pop-centric,
includes EDM) with 8-fold cross-validation; the paper claims state-of-the-art on all four tasks
on Harmonix *(claim confirmed via Semantic Scholar/HF paper pages; the actual F1 table was not
retrievable this pass — arxiv blocked — so I cite no segmentation F-numbers rather than guess)*.
Reported throughput: **10 songs (33 min) in 73 s on an RTX 4090** *(single-source: project
reporting)*. Install caveats are real: requires PyTorch, Demucs, **NATTEN (manual install on
Linux/Windows)**, and **madmom installed from git** because the PyPI madmom (0.16.1, Nov 2018,
Python ≤3.7 classifiers — confirmed via PyPI) doesn't install on modern Python. The existence of
an `all-in-one-fix` package on PyPI is corroborating evidence that stock install friction is high
*(single-source; the PyPI page itself failed to load)*.

**Electronic-music accuracy expectations** *(single-source but directly on point)*: EDMFormer
(arXiv:2603.08759, 2026) exists precisely because "existing models perform poorly on EDM" — pop
segmentation cues (lyrics/harmony) don't transfer to structure defined by energy/rhythm/timbre
(buildup/drop/breakdown). It ships an EDM-specific taxonomy and the **EDM-98** dataset (98
professionally annotated tracks) and evaluates with HR@0.5s/HR@3s; general models were tested
zero-shot and found lacking. I could not retrieve its numeric table, code availability, or
license — **inconclusive** whether it's usable yet. Honest expectation to carry: allin1's
boundaries and labels will be noticeably weaker on electronic tracks than its Harmonix
(pop-trained) headline, and labels like "verse/chorus" are the wrong vocabulary for a techno
track; boundaries + bar grid are the trustworthy part.

Classic non-neural fallback: MSAF (Nieto & Bello, ISMIR 2015) packages boundary/label algorithms
behind one API — useful for unsupervised novelty-based sectioning with zero model weights, though
accuracy is well below the neural systems *(single-source this pass; license not checked)*.

## 3. Beat / downbeat / tempo, and chords

**Beat/downbeat — the clean winner** *(confirmed — CPJKU/beat_this repo fetched)*: **Beat This!**
(Foscarin, Schlüter, Widmer, ISMIR 2024) is **MIT for code AND published weights** — the explicit
weight licensing madmom lacks. Outputs beat + downbeat times; CLI (`beat_this audio -o out`),
Python API, and torch.hub loading; PyTorch 2.0+, GPU recommended but CPU works. No explicit tempo
output — derive BPM from median inter-beat interval (allin1 does report BPM directly). Reported
accuracy: **GTZAN beat F1 88.9, downbeat F1 75.5** *(single-source: numbers via the BeatFM paper
(arXiv:2508.09790) reporting its baseline comparison; direction confirmed by the paper's own
"surpasses the state of the art without DBN postprocessing" claim)*. BeatFM (2025) claims to beat
it (downbeat 79.6) but its license/availability went unchecked — **inconclusive**. A C++ port
(`mosynthkey/beat_this_cpp`) exists *(single-source)*.

**The madmom trap** *(confirmed — LICENSE file fetched)*: madmom's source is BSD-2-Clause, but
**"data and model files" are CC-BY-NC-SA 4.0** — "You must not use the material for commercial
purposes," commercial licensing via Gerhard Widmer, and the license explicitly says pickled
models are covered. Any dotbeat feature built on madmom's pretrained beat/downbeat/chord/key
models inherits a non-commercial restriction that contradicts dotbeat's MIT posture. Its
algorithm *code* (e.g. DBN post-processing classes) is BSD and fine — which is presumably why
allin1 can be MIT while depending on it, but that boundary is delicate; safest is to not depend
on madmom models at all. PyPI package is stale since 2018 (git-install only on modern Python).

**Chord recognition** *(mixed)*: the field's honest ceiling first — major/minor-vocabulary WCSR
sits around **75-87%, with recent systems (e.g. ChordFormer, 2025) at ~83-84%** and documented
MIREX-era stagnation *(confirmed direction across multiple 2025-2026 papers surfaced in search;
individual figures single-source)*. Expect roughly "4 in 5 chords right, on harmony-forward
material" — worse on synth-heavy electronic tracks. Implementations by license:
- **BTC** (`jayg996/BTC-ISMIR19`, bi-directional transformer, ISMIR 2019): **MIT**, outputs
  time-stamped `.lab` + MIDI, maj/min or large vocabulary *(confirmed — repo fetched; whether
  pretrained weights are downloadable was not clear from the README — inconclusive)*.
- **crema** (McFee): **BSD-2**, chord estimator, but quiet since v0.2.0 (April 2022)
  *(confirmed — repo fetched)*.
- **Chordino/NNLS-chroma**: GPLv2+ Vamp plugin *(confirmed — project pages)* — viral if linked
  in-process; acceptable only as a separately-installed external process, and probably not worth
  the packaging pain. `autochord` wraps it + a BiLSTM-CRF and self-reports **67.33% test
  accuracy over 25 classes** *(single-source: its ISMIR 2021 LBD)*.
- **Essentia** (incl. essentia.js): **AGPL-3.0** *(confirmed — repo fetched)* — a nonstarter for
  MIT dotbeat despite being the one full MIR suite with a JS story.
- madmom's chord models: NC, see above.

## 4. Melody / MIDI transcription

**basic-pitch is still the fit** *(confirmed — spotify/basic-pitch + basic-pitch-ts fetched)*:
Apache-2.0, ICASSP 2022 ("A Lightweight Instrument-Agnostic Model for Polyphonic Note
Transcription and Multipitch Estimation"), instrument-agnostic, polyphonic, outputs MIDI with
pitch bends. Deliberately small ("note accuracy competes with much larger and more
resource-hungry AMT systems"). Latest Python release v0.4.0, Aug 2024 — slow-moving but alive.
**Uniquely in this entire research pass, it has an official TypeScript sibling:
`@spotify/basic-pitch` on npm, Apache-2.0, running on TensorFlow.js** — the only zero-sidecar,
pure-Node option in any of the five capability areas.

**Successors** *(confirmed existence; numbers thin)*: the 2025 AMT Challenge
(arXiv:2603.27528) had several submissions beat the MT3 baseline, with persistent weaknesses
called out: dense polyphony, timbrally-similar instruments, limited data diversity. YourMT3+
(QMUL, MLSP 2024) is the strongest maintained multi-instrument line — but the repo is
**GPL-3.0** *(confirmed — repo fetched)*, so like Essentia it's reference-only for dotbeat.
Newer entries (MuScriptor, MIROS/MusicFM-backbone systems) exist but licenses/checkpoints went
unchecked — **inconclusive**. Practical read: for dotbeat's purpose (extract a melodic/harmonic
sketch from a reference, not archival transcription), basic-pitch's quality tier is sufficient
and its license/integration story is unbeatable; revisit the GPL-free frontier only if pilots
show basic-pitch output is too noisy to be useful.

## 5. Synthesis — what feeds dotbeat, and the first slice

**Licensing fit with MIT dotbeat** (echoing pass 07's engine-vs-content lesson — model weights
are content):

| Use freely | Avoid / external-only |
|---|---|
| Demucs code+models (MIT repo; weight-license inference noted §1) | madmom pretrained models (CC-BY-NC-SA) |
| audio-separator, demucs.cpp (MIT) | RoFormer community checkpoints (NC / unstated) |
| Beat This code **and weights** (MIT, explicit) | Essentia / essentia.js (AGPL) |
| allin1 (MIT), MSAF | Chordino/NNLS-chroma (GPL — external process only) |
| basic-pitch Python + TS (Apache-2.0) | YourMT3+ (GPL-3.0) |
| BTC (MIT), crema (BSD-2) | |

**Copyright posture, stated plainly**: dotbeat analyzes reference tracks to extract *facts and
structure* — tempo, bar grid, section boundaries, band-energy profile, chord labels, a melodic
sketch. Those analysis results are data about the recording, and using them as a reference to
guide original work is standard practice. **Audio from an analyzed track never enters a dotbeat
project**: not the file, not separated stems (a stem of a copyrighted recording is still that
recording), not resynthesized snippets of its audio. Separation runs only to make *measurements*
(per-stem loudness/spectral profiles) and the stems are treated as disposable intermediates, not
project media. The analysis artifact dotbeat stores is JSON of numbers and labels — safe to
commit, diff, and share. Transcribed MIDI is the one gray zone (a melody is itself copyrightable
subject matter), so transcription output should be framed and documented as reference material
for studying a track, with the same "don't paste it into your song" posture as audio.

**Concrete feeds**:
1. **Reference profile (Stream OD)** — separation makes OD's full-mix profile per-stem: run
   htdemucs (via audio-separator), compute the existing metric set per stem, store
   `{drums,bass,vocals,other} × {LUFS, band shares, crest}` in the same profile JSON. Directly
   answers OD's own stated limit ("does not hear masking/arrangement").
2. **`.beat` song-skeleton generator** — allin1 (or Beat This + a boundary fallback) turns a
   reference into `{bpm, downbeat grid, sections[]}`; a generator maps that to an empty `.beat`
   with tempo set and named/length-matched sections — "give me the shape of *Strobe*" without a
   note of its audio.
3. **Chord/clip suggestions** — BTC or crema chord lab files → suggested clip chord tracks;
   basic-pitch → a melodic-contour reference. Lowest confidence tier (chord ~80% ceiling, worse
   on electronic material) — ship behind wording like "roughly F#m–D–A–E" rather than as truth.

**Recommended first slice** (one stream of a future phase): **`beat analyze <audio>` — a Python
sidecar + JSON artifact + tempo/structure skeleton.** Scope: (a) establish the sidecar
convention once — an optional `analysis/` extra with its own venv/requirements, invoked as a
child process, output cached as `<name>.analysis.json` next to the media, feature degrades
gracefully with a clear "pip install" message when Python is absent; (b) run **Beat This** (MIT
weights, lightest clean dependency) for beats/downbeats, derive BPM; (c) spike **allin1** for
sections behind the same interface — adopt it if the NATTEN/madmom-git install survives the
spike on a clean machine, otherwise ship boundaries-only via novelty detection and revisit; (d)
`beat skeleton <analysis.json>` emits the empty structure-matched `.beat`. Deliberately
excluded from slice one: separation (needed only when OD wants per-stem profiles — natural
slice two), chords and melody (lowest confidence, needs the sidecar to exist first). Effort:
comparable to a mid-sized CLI stream (an OC-sized stream, not an OA-sized one) — the sidecar
plumbing and its failure modes are the real work; the models themselves are turnkey. Wrap-up
per standing practice: a CLI pilot against `beat analyze`/`beat skeleton`.

## Open questions / honest gaps

1. **allin1's exact Harmonix F1 table and any published electronic-music breakdown** — arxiv was
   proxy-blocked; the SOTA claim is confirmed, the magnitudes are not in this doc. Fetch the
   paper before leaning on specific accuracy promises in user-facing copy.
2. **EDMFormer usability** (code? license? checkpoint?) — could be the right segmentation
   upgrade for dotbeat's genre center of gravity; entirely unverified beyond its abstract.
3. **Demucs weight licensing as a verified fact** (vs. ecosystem-treats-it-as-MIT inference) —
   worth pinning down before shipping a feature that downloads the weights.
4. **BTC pretrained-weight availability** — MIT code confirmed, downloadable checkpoint not.
   If absent, crema becomes the default chord path despite its age.
5. **Whether allin1's madmom dependency touches madmom's NC models at runtime** or only BSD
   algorithm code — delicate licensing boundary asserted by inference only.
6. **2026 transcription frontier under permissive licenses** — everything clearly better than
   basic-pitch that I could verify is GPL or unlicensed research code; a deliberate re-check in
   6-12 months is cheaper than betting on it now.

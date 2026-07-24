# Research 125 — MIDI model trials: actually running AMT, CA2, and MIDI-RWKV on this Mac

*Hands-on follow-up to `docs/research/124-midi-composition.md` Part A, which was desk-only ("Nothing
here was run"). This pass installed and ran the shortlisted local symbolic-music models on the
owner's machine (Apple Silicon Mac, macOS, MPS available) and produced listenable evidence. Method:
built a fixed 3-figure test kit from the private commercial-MIDI dataset via `python/midi_extract.py`,
ran each model against dotbeat's four workflows (W1 continue · W2 harmonize · W3 vary · W4 infill),
3 seeds each, saved every output as `.mid` with a manifest (wall-clock, device, seed), rendered the
12 most informative through dotbeat's own engine to WAV, and ran MuSpy-style lint (scale consistency
vs the prompt's key, empty-bar rate) on every output. All work lives in the PRIVATE workspace
`~/Documents/dotbeat/taste-dataset/compose-lab/` (never committed). Single operator, one machine, one
afternoon — treat quality reads as directional, not a listening study. Companion:
`docs/source-showdown-eval.md` (the eval any adopted source must feed), research/124 (the desk survey
this verifies).*

## Headline answers

1. **Both AMT and CA2 install and run on this Mac on MPS, in minutes, at interactive speed** —
   research/124's "should work (medium)" is now "worked (high)." AMT (128M) loads in 0.1s and
   generates in 0.2–63s; CA2 (192M T5) loads in 0.7s and generates every task in under 3s. No CUDA,
   no cloud. (High — measured.) §1, §2
2. **Composer's Assistant 2 is the clear winner for dotbeat's genres and workflows, and it beats AMT
   decisively.** CA2 stayed in the prompt's key on **10 of 12** generations (vs AMT's 5 of 12, and 2
   of AMT's were trivially in-key because it added ~0 notes), produced *sparse, role-appropriate* bass
   (5–15 notes where AMT emitted a 145-note wall), actually generated accompaniment where AMT declined
   to, and — uniquely — did true **same-rhythm-new-notes** variation with a 100% rhythm match. (High —
   measured on this kit.) §2
3. **AMT's headline weakness is genre mismatch, exactly as predicted.** Trained on Lakh (pop/rock/
   piano), it renders a *busy* texture for what should be a spare electronic bassline, its flagship
   anticipatory **accompaniment returns ~0 notes on a dense synth lead** (verified across two control
   configs), it has no rhythm-lock for W3, and it intermittently crashes on dense output (a duration
   token over `MAX_DUR`) needing a clamp+reseed workaround. Its one genuinely good mode is **infill
   (W4)** — its core capability — which stayed in key 3/3. (High.) §1
4. **MIDI-RWKV is real but a much heavier lift; not run here (per the stretch-goal brief).** Base
   weights ship in-repo (70MB, MIT), but inference is welded to git *submodules* over SSH plus a
   `rwkv.cpp` C++/GGML build and an eval-harness entry point — materially more friction than AMT's
   `pip install` or CA2's unzip-and-drive. Its distinctive draw, LoRA/state-tuning on the owner's own
   MIDI (~6-min adapter per the paper), needs the full training stack and remains unverified. (High on
   the friction; medium on the LoRA claim — from the paper, not run.) §3
5. **Recommendation: wire CA2 into showdown as a fifth figure source, over the deterministic layer's
   chord track (the §A.4 LLM-as-orchestrator shape). Keep AMT only as an infill/`vary`-region helper.**
   CA2 is fast, in-key, controllable, and cleanly separable from REAPER — a standalone Python driver
   with no REAPER and no SentencePiece already works here. The predicted null ("deterministic recipes
   beat all models in-genre") holds against AMT but is **not** obviously true against CA2 — that is the
   batch series to run. (Medium — design proposal; the blind eval decides.) §4

---

## The test kit (shared across all models)

Three figures extracted from the private commercial-MIDI set with `python/midi_extract.py`, each on a
16th-note grid:

- **bass** — Daft Punk, *Around the World* · E minor · 123 bpm · 21 notes (used for W1 continue, W4 infill)
- **lead** — deadmau5, *Strobe* · A♭ minor · 128 bpm · 64 notes, a dense arpeggio (W2 harmonize, W3 vary)
- **chords** — Swedish House Mafia, *One* · C major · 120 bpm (kit spare)

Tasks: **W1** give 2 bars of bass, continue to 4 · **W2** accompany the lead · **W3** regenerate a
2-bar motif keeping its rhythm · **W4** delete bar 3 of the 4-bar bass and infill it. 3 seeds each.
Lint threshold for "in key": scale-consistency vs the prompt key ≥ 0.75.

Workspace map: `compose-lab/testkit/` (kit + `manifest.json`), `compose-lab/outputs/<model>/<task>/`
(all `.mid` + per-task `manifest.json` with seed/wall/device), `compose-lab/renders/` (WAV),
`compose-lab/tools/` (venvs + drivers), `compose-lab/NOTES.md` (running log).

---

## §1 Anticipatory Music Transformer (Stanford CRFM)

**Install friction (exact steps that worked).** Python 3.10 venv (system Python is 3.14 — too new for
torch; 3.10 is the safe choice on this box). Then:

```
pip install torch numpy 'transformers<4.50' huggingface_hub mido
pip install git+https://github.com/jthickstun/anticipation.git
```

torch 2.13.0 reports `mps.is_available() == True`. Checkpoint **`stanford-crfm/music-small-ar-100k`**
(Lakh-only, 128M, `pytorch_model.bin` ~500MB) — chosen for provenance per §A.1. **The download hit
the known SSL 0%-CPU stall** (memory: `hf-hub-hang-diagnostic`); `huggingface_hub.snapshot_download`
resumed it cleanly, after which `HF_HUB_OFFLINE=1` + `local_files_only=True` load instantly. Total
setup ≈ 10 min, most of it the download. **Friction: low.** (High.)

**Speed on this hardware (MPS).** Model load 0.1–0.2s (offline). Generation is proportional to notes
emitted: W4 infill 0.6–4.9s, W1 continue 5.9–63s, W3 vary 16–32s (it generates a lot), W2 ~0.2s
(because it generates almost nothing — see below). Fully usable interactively. (High.)

**W1–W4 results** (scale-consistency vs prompt key; "in-key" = ≥0.75):

| task | in-key | key-consistency (3 seeds) | notes generated | read |
|------|--------|---------------------------|-----------------|------|
| W1 continue | 1/3 | 0.58, 0.82, 0.72 | 72–167 | **dense, wrong texture** for a bass |
| W2 harmonize | 3/3\* | 1.0, 0.97, 1.0 | +1–2 only | \*trivial: output ≈ the original lead |
| W3 vary | 1/3 | 0.70, 0.54, 0.77 | 138–148 | busy; **no rhythm preservation** |
| W4 infill | 3/3 | 0.89, 0.91, 0.84 | 28–76 | **its genuine strength** |

**Subjective / genre-fit read (blunt).** AMT behaves like a pop/rock model asked to do techno, which
is what it is. For a spare 2-pitch-class electronic bassline it returns a 100+-note flurry — musical
in a Lakh sense, wrong for the idiom. **Its anticipatory accompaniment — the paper's flagship demo —
failed on this material**: feeding the dense *Strobe* lead as anticipated controls returned 2 tokens
(nothing) for both the empty-prompt and bass-seed configs; only feeding the lead as ordinary inputs
coaxed out 1–2 added notes. On sparser, more pop-shaped input it would likely do better, but that is
not dotbeat's genre. **Infill is the exception** — bar-3 fills were in-key and plausible, consistent
with §A.1's "span infilling is the core capability."

**Integration friction found (report-worthy).** (1) Accompaniment is effectively empty on dense
leads. (2) Dense generations intermittently emit a duration over `MAX_DUR` and crash
`events_to_midi`; a duration clamp + reseed-retry is a legitimate but real workaround. (3) No
rhythm-lock control for W3. (4) The target instrument must be set as a GM program in the input MIDI or
AMT continues the wrong voice. (High — all hit directly.)

## §2 Composer's Assistant 2 (Malandro, ISMIR 2024)

**Install friction (exact steps that worked).** The git repo does **not** contain the weights; they
live in the v2.1.0 **release zip** (`composers.assistant.v.2.1.0.zip`, **716MB** — the first download
truncated at 555MB and a corrupt-zip error; `curl -C -` resume fixed it). Unzip gives
`Scripts/composers_assistant_v2/` with the model at
`models_permuted_labels/unjoined/infill/finetuned_epoch_49_0/model` (a 192M T5, `pytorch_model.bin`
769MB) and no SentencePiece model — so the **unjoined tokenizer path (pure Python) is used, no
`sentencepiece` needed**. Reused the AMT venv + `pip install miditoolkit`. **CA2 detaches from REAPER
with modest effort, as §A.1 predicted**: a ~200-line standalone driver imports its modules directly
(`midisong`, `encoding_functions`, `preprocessing_functions`, `unjoined_vocab_tokenizer`,
`nn_str_functions`) and never touches REAPER or its RPC. **Friction: low-moderate** (the truncated
download + finding the standalone encode/decode path were the only speed bumps). (High.)

The standalone pipeline: `MidiSong.from_midi_file` → `MidiSongByMeasure` →
`encode_midisongbymeasure_with_masks(mask_locations=[(track, measure), …])` →
`T5.generate(top_p=0.85)` → `instructions_by_extra_id(output)` → walk `N`/`d`/`w` note instructions
(CPQ=24, a 16th = 6 clicks) back to notes. `mask_locations` is exactly dotbeat's four workflows: mask
future bars (W1), mask an empty second track (W2), mask a region with rhythmic conditioning (W3), mask
one interior bar (W4).

**Speed on this hardware (MPS).** Load 0.7s; **every task under 3s** (W1 <1s, W4 <0.3s, W2 1.4–2.8s,
W3 2.0–2.6s). (High.)

**W1–W4 results:**

| task | in-key | key-consistency (3 seeds) | notes generated | read |
|------|--------|---------------------------|-----------------|------|
| W1 continue | 1/3 | 1.0, 0.67, 0.0 | 5–15 | **sparse & bass-shaped**; seed 3 drifted out of key |
| W2 harmonize | 3/3 | 1.0, 1.0, 1.0 | 40–76 | **real, in-key accompaniment** (AMT gave ~0) |
| W3 vary | 3/3 | 0.80, 0.96, 0.90 | 47–49 | **100% rhythm match**, new pitches |
| W4 infill | 3/3 | 1.0, 1.0, 1.0 | 5–6 | clean, perfectly in-key |

**Subjective / genre-fit read (blunt).** CA2 is the one that behaves like it understands the job. Its
bass continuations are sparse and register-appropriate rather than a note-storm; its accompaniment
(masking an empty pad/keys track under the lead) is its flagship multi-track infill and it works,
staying dead in A♭ minor across all three seeds; its **W3 rhythmic conditioning
(`explicit_rhythmic_conditioning_locations` + `1d_flattening`) is exactly §C.3/§A.1's
same-rhythm-new-notes operator** and it reproduced all 32 of the motif's onset steps while changing
the pitches — the single most dotbeat-shaped capability found in any model. The one wobble: W1 seed 3
went fully out of key (0.0), so it is not infallible and still needs the blind eval as the gate. It is
not virtuoso — "useful sketch collaborator" is the right ceiling — but it is *usable in-genre today*.
Provenance is also the cleanest in the survey (public-domain/permissive-only training set, §A.3),
which matters if a figure source is ever shipped. (High on the measurements; medium on the quality
generalization from one kit.)

## §3 MIDI-RWKV (stretch goal — desk-assessed, not run)

Per the brief (base inference only if 1–2 went smoothly; note LoRA feasibility without running it),
this was assessed from the cloned repo, not executed. **Base weights are present** (`midi_rwkv.pth`,
70MB, RWKV-7 small, MIT). But **base inference is not a library call**: `rwkv.cpp` (inference),
`RWKV-PEFT` (LoRA), and `MIDIMetrics` are git **submodules with `git@github` SSH URLs** (absent from a
shallow HTTPS clone), and the inference entry point (`rwkv.cpp/python/generate.py`) is welded to the
evaluation harness — it expects GigaMIDI/POP909 test-MIDI folders and a GGML model conversion
(`convert_model_to_cpp.sh`), not a "infill this file" API. Standing up base inference here would mean:
SSH submodule init → cmake C++ build of `rwkv.cpp` → GGML conversion → MidiTok MMM tokenizer setup →
adapting the eval script. **Feasible, but hours, not minutes** — the heaviest of the three. (High.)

**LoRA feasibility (from README + paper, not run).** `RWKV-PEFT/scripts/run-lora.sh` and
`run-state-tuning.sh` are provided; the POP909 finetune set is referenced; the paper reports a
2.7M-param adapter trained in ~6 min on consumer hardware. This own-data personalization is RWKV's
genuine differentiator and the reason to keep it on the watch list, but it needs the full training
stack (`pytorch-lightning==1.9.5`, deepspeed, the PEFT submodule) and is unverified here. Provenance
is GigaMIDI (research-grade, not commercially clean). (Medium — paper claim.)

## §4 Verdicts and recommendation

**Mac feasibility verdict.** AMT and CA2 are **fully Mac-feasible on MPS today** — small models,
instant load, interactive generation, no cloud, no CUDA. MIDI-RWKV base inference is feasible but
gated behind a C++/GGML build and SSH submodules (hours). Silent-render gotcha worth recording for the
downstream pipeline: a `.beat` clip renders **silent unless placed in a scene + song section** — the
generated figures only produced audio once `make_beat.py` emitted `scene main / slot inst a / song /
section main N` (the known `beat render` unplaced-content behavior from the dotbeat skill). (High.)

**Which model earns wiring into showdown: CA2.** It is the only one that is fast, stays in key,
generates role-appropriate density, offers the controls dotbeat actually wants (rhythm preservation,
density, mono/poly, per-measure masking), and has clean provenance. AMT earns a **narrow** role: an
**infill / `vary`-a-region** helper (its one strong mode), not a general figure generator, and never
for accompaniment on electronic material.

**Integration shape (the §A.4 LLM-as-orchestrator).** Wire CA2 as a new figure-source *kind* exactly
as `gen`/`surge`/`midi` did (`docs/source-showdown-eval.md`): the deterministic composition layer
(research/124 §C.7) owns the chord track + key + kick, and the agent asks CA2 to fill specific
(track, measure) cells over that harmonic source of truth — mask the bars to (re)generate, pass the
key/register via the input MIDI and CA2's per-measure commands, and route candidates into the existing
render+rate loop, sound-source held constant so the blind rating isolates composition. The standalone
driver here (`compose-lab/tools/run_ca2.py`) is a working reference for that sidecar; it needs only a
stable "song-dict in, notes out" contract to become the twin of `midi_extract.py`. (Medium — design
proposal.)

**On the predicted null.** Research/124 forecast "deterministic recipes beat all models in-genre." For
**AMT that holds** — its in-genre output is worse than dotbeat's key-locked archetypes on every task
but infill. For **CA2 it does not obviously hold**: in-key, sparse, controllable, rhythm-preserving
output is a real candidate the archetype bank may *not* dominate. That is the valuable, testable
outcome: run "archetype vs CA2-over-chord-track vs commercial-MIDI" as a blind showdown series and let
`beat rate` decide. The deterministic layer is still the higher-leverage build (it owns harmony and
needs no weights), but CA2 is the first model in this program worth the integration cost.

## Where the listenable evidence is

12 WAV renders in `~/Documents/dotbeat/taste-dataset/compose-lab/renders/`, all through dotbeat's own
engine (`node cli/beat.mjs render`), verified non-silent (RMS/peak checked):
`ref-bass-daftpunk`, `ref-lead-strobe` (the source figures, for A/B), `amt-bassline-continue-2`,
`amt-bass-infill-1`, `amt-lead-vary-1`, `amt-harmonize-1` (hear the near-empty accompaniment),
`ca2-bassline-continue-1/2`, `ca2-harmonize-1/2`, `ca2-lead-vary-2` (the rhythm-locked variation),
`ca2-bass-infill-1`. The `.beat` sources are in `compose-lab/beats/`; every raw `.mid` + manifest is
under `compose-lab/outputs/<model>/<task>/`.

## Honest gaps

- **One kit, one operator, one afternoon.** Three figures in three keys; quality reads are directional,
  not a listening study. The real verdict is a blind `beat showdown` series, not this report.
- **CA2's quality generalization is from a small sample.** 10/12 in-key is a lint pass, not a musical
  endorsement; scale-consistency catches gross errors, not whether a phrase is *good* (research/121's
  "metrics catch gross errors, ears decide"). The renders exist so the owner can make that call.
- **AMT was judged on hard cases for it** (dense electronic material) with one Lakh-only checkpoint;
  the -medium/-large checkpoints and sparser inputs were not tried, and its accompaniment may fare
  better on pop-shaped material. Its infill strength is likely understated by this genre.
- **MIDI-RWKV was not run** — base-inference friction and LoRA feasibility are read from the repo and
  paper, not executed. The "6-minute personalization" claim is unverified on this hardware.
- **The renders use a single generic synth patch per role**, not produced sound — they isolate
  *composition*, exactly as the showdown eval intends, but they will sound plainer than a finished
  dotbeat clip. Do not judge timbre from them.
- **W2's accompaniment setup is my construction** (masking an added empty track); a different track/
  instrument choice could change AMT's and CA2's output. The "AMT returns ~0 notes" finding was
  cross-checked across two configs, but the space of accompaniment framings is larger than tested.

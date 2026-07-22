# Source-showdown eval: where does good sound come from?

*Companion to `docs/taste-loop-design.md` (the taste program this feeds). Built 2026-07-18 from
the owner's observation of the same day: synth-produced chords/arps sound bad to them, the
fal-generated sounds are the most interesting thus far, and the drum/bass presets are middling.
This eval turns that impression into a tracked number per musical role.*

## What it measures

For each **musical role** — bassline, chords, lead, drum-loop — a showdown batch holds one clip
per **source pipeline**, blind, loudness-matched, duration-matched:

| source   | what it is | what a win means |
|----------|------------|------------------|
| `engine` | the role's phrase from a taste-seed song, soloed, rendered through dotbeat's own synth engine | the synth engine can carry this part |
| `engineplus` | (opt-in, `--with-produced`) the **same figure and patch** as the engine clip plus a production pass applied as ordinary `.beat` edits | the engine's deficit is production, not timbre — see "The engineplus ablation" below |
| `gen`    | a hosted-generation phrase (fal, Stable Audio; the prompt bank's phrase tier — bassline / chords / melody / drumloop subjects, 4 bars) | raw generation beats everything the engine does |
| `keymap` | a generated **one-shot** turned into an instrument (`beat keymap` for pitched roles, sample-backed drum lanes for the drum-loop role) playing the **same seed phrase** through the engine's sampler | the hybrid wins: generated *timbre* + engine *notes* |
| `surge`  | (opt-in, `--with-surge`, **pitched roles only**) a composed figure rendered through a **Surge XT factory patch** via the `surgepy` sidecar — see "The surge source" below | a serious open-source synth + patch library closes the timbre gap dotbeat's own engine can't |
| `ref`    | (opt-in, off by default) a clip from a private directory of commercial-music chops | the private ceiling — how far every pipeline still is from records the owner loves |

The rating is the owner's ears through the **unchanged** blind `beat rate` flow; the scoreboard is
`beat showdown --report`: per-source win rate, top-half rate, and pairwise win rate — overall and
per role, with the same small-n "smoke, not evidence" label taste-eval's splits use
(`SPLIT_SMOKE_MIN_BATCHES = 5` per split).

## Why per-role

The owner's impression is already role-shaped ("chords/arps sound bad" is not "the engine sounds
bad"): the engine may hold its own on basslines while losing every chords batch, and the answer
drives different work — a losing role's engine clips are an evidence-backed feature request (the
same logic as the T6 expressiveness-ceiling study), while a winning `gen` role says spend fal
budget there. One pooled number would average those stories away. `beat rate`'s picks land in the
one `beat-scores.jsonl` with group `showdown:<role>` and a per-variant `sources` map (kinds
keyed by variant file), so the report — and any later model work — can split by role forever,
even after batch dirs are deleted.

## How a batch is built (`beat showdown <dir>`)

Per role, per round, from a `beat taste-seeds` directory:

1. Pick a seed song that carries the role's track (the arp track is optional per seed) and loop
   its 2-bar content out to 4 bars (the gen phrase tier's length).
2. **engine**: solo the role's track (target boosted to −4 dB, everything else muted at −60 —
   taste-collect's salience convention) and render offline through the engine.
3. **keymap**: generate a one-shot from the prompt bank (`bass`/`stab`/`pluck` for the pitched
   roles; `kick`/`snare`/`hat` for drum-loop), register it into a scratch project, then:
   pitched — detect its root (`src/analysis/pitch.ts`; low confidence falls back to the
   strongest-low-partial suggestion rather than refusing — this is an automated pipeline and the
   chosen root is recorded), build a chromatic keymap over the phrase's octave-recentred span,
   and write the seed phrase as hits; drum-loop — re-back the seed's kick/snare/hat lanes with
   the generated one-shots, pattern untouched. Rendered in the same one-boot batch render as the
   engine clip.
4. **engineplus** (only with `--with-produced`): `applyProductionTreatment` on the engine clip's
   own soloed doc — identical notes, identical patch — rendered in the same one-boot batch as the
   engine and keymap clips.
5. **gen**: one phrase-tier candidate through the standard `genSourceBatch` prep pipeline
   (`--gen-backend stub` for CI/testing, `fal` for real collection).
6. **ref** (only with `--ref-dir`): pick a `.wav` under the given path (a `<ref-dir>/<role>/`
   subdir scopes the pool when present).
7. Assemble: sources are shuffled into `v1..vN.wav` with a seeded permutation (first blinding
   layer — `beat rate` shuffles presentation again), the manifest records each clip's
   `source.kind` + provenance, clips are duration-matched (trim-with-fade / zero-pad to the
   shortest clip; `--seconds` overrides), and the whole batch is gain-matched to a common LUFS by
   the same `normalizeBatchLoudness` every vary batch uses — cross-source loudness differences
   are exactly the confound the taste program controls away.
8. **BPM matching** (owner, 2026-07-21, mid-rating: mixed tempos in one blind batch are both a
   tell and a comparison killer): the ref clip is the only source that can't be re-rendered, so
   the batch conforms to IT — its tempo is detected with the analysis sidecar (`beat analyze`
   beatthis, cached next to the wav), folded out of half/double-time into 70-180
   (`foldBpmToRange`), and the composed clips render at that bpm while the gen prompt carries it
   as an explicit `N BPM` hint. Without a ref (or without the sidecar — stub/CI), everything
   conforms to the seed's own bpm, which still pins gen to the composed clips.

The batch is an ordinary clip-set batch (empty parent: score works, adopt refuses), group
`showdown:<role>`, so `beat rate` queues it, `beat score` logs it, and taste-eval's ablation
splits classify it as its own `showdown` variant type.

## The engineplus ablation (`--with-produced`)

Feature-mining the first 21 rated batches (2026-07-21) found the engine losing (4% pairwise wins
vs ref's 94%) on **production**, not obviously on timbre: its clips were dead mono (stereo
correlation 1.00, width −52 dB vs ref −11 dB — the batch solos one center-panned single-voice
track), had near-zero air band (0.22% vs 1.89% of energy above ~10 kHz), and scored lowest on
Audiobox's production-*complexity* axis while production-*quality* was flat across sources. That
leaves the causal question open: **is the engine's deficit the synth, or the absence of a
production pass?**

`engineplus` answers it as a controlled ablation. It is the engine clip's own soloed document —
same composed figure to the note, same patch — plus a production treatment applied entirely as
ordinary `.beat` edits from the existing format vocabulary (`applyProductionTreatment` in
`src/taste/showdown.ts`; no new engine features):

- **width/thickness** — an `osc2` detune layer of the same oscillator (+10 cents, level 0.35)
  plus the unison stack's real stereo spread (`unisonVoices 5`, `unisonWidth 0.6`), and a light
  chorus insert; drum tracks skip the osc-bank edits (drum voices don't read them) and get their
  width from the chorus + the stereo reverb return
- **glue/drive** — the always-wired saturator insert (`saturatorDrive 0.25`, `saturatorMix 0.3`)
- **space** — shared return-bus sends (`sendReverb 0.18`; `sendDelay 0.08` on pitched roles only —
  a delay on drums re-writes the groove)
- **air** — `eqHigh +2.5 dB` through the default `eq3` insert's high shelf

Every treatment on the wishlist existed in the format already, so none were skipped; values only
ever *intensify* (`Math.max` against the patch's own settings), so a seed patch that already
carries production keeps it. The manifest's `from` records exactly which edits were applied; the
scores log records the kind only, like every other source.

**Reading the result**: engineplus ≈ ref-ward of engine by a large margin means the cheap fix is
production defaults (width/air/sends out of the box), not a new synth. engineplus ≈ engine means
the deficit really is timbre, and the synth itself is the work.

## The surge source (`--with-surge`)

The engine measured a hard timbre ceiling in the showdown (research 114: ~3% blind pairwise vs
real records, a measured 2.4–3.4× timbre gap over its own self-match floor). Research 114's
cheapest first experiment is to ask whether a **serious open-source synth**, driven by its own
**pro-grade factory patch library**, closes that gap — in the "sound factory" shape (an external
engine renders audio offline; dotbeat plays the bytes) rather than as a live device.

`--with-surge` adds one `surge` clip per **pitched-role** batch (bassline / chords / lead;
**drum-loop is skipped** — a kit through a synth patch is a different question). The clip is:

1. **its own composed figure** — drawn from the same archetype bank as the other composed sources,
   with the batch's exclude-chain so it's a *distinct* figure (the un-blinding fix: a batch where
   every dotbeat-composed clip shares one melody reveals the composed cluster). With
   `--shared-figure` the surge clip instead reuses the batch's shared figure, restoring the
   controlled "same notes, different sound-source" ablation.
2. rendered through a **Surge XT factory patch** picked deterministically per batch seed from the
   role's patch categories (bassline → *Basses*; chords → *Pads* / *Keys*; lead → *Leads* /
   *Plucks*), via `python/surge_render.py` (the `surgepy` bindings). The chosen patch name +
   category is recorded in the batch manifest's `from` (local info); the shared scores log stays
   kind-only (`"surge"`), same as every other source.
3. then the **same duration-match + loudness-normalize** pipeline every other source rides.

**What a win means**: a pro synth + patch library beats dotbeat's engine on raw timbre, and the
live-device path research 114 gates behind this result (webdx7 first, being permissively licensed)
earns its complexity. A loss says the engine's own sound isn't the bottleneck.

**Setup — `surgepy` is a source build, not a pip install.** Confirmed 2026-07-21: `pip install
surgepy` fails ("No matching distribution found") — there is **no PyPI wheel**. surgepy ships only
as a compiled artifact of Surge XT's own CMake build (`-DSURGE_BUILD_PYTHON_BINDINGS=TRUE`, target
`surgepy`). `beat showdown --surge-doctor` reports surgepy availability, the Surge factory-content
path, and the factory patch count — and, when surgepy is absent, the exact build steps. Full build
instructions are in `python/README.md`. In any environment without surgepy built (CI, a fresh
machine), `--with-surge` prints one warning and collects the other four sources — it never breaks a
batch.

### The surge licensing posture

Surge XT is **GPLv3**. That is fine here because surge runs as an **out-of-process render tool**
(mere aggregation; the rendered audio carries no code copyleft — research 114 §2.1), never linked
into a shippable dotbeat build. But the **factory-patch _content_ license is unresolved upstream**
(surge issue #6741 proposed CC-BY-SA for patches/wavetables; still open at last check). So until
that resolves, surge renders are treated **exactly like the private ref chops**:

- every batch containing a `surge` clip gets a generated `.gitignore` (`*`) so rendered factory-
  patch audio can never land in git even inside a repo (`writeShowdownBatch`).
- the batch manifest records the patch name/category as local provenance only; the shared scores
  log records the source **kind** (`"surge"`) and nothing else.

Re-check surge issue #6741 before ever publishing a Surge-rendered clip.

### The right-ear ring bug (root-caused + fixed 2026-07-22)

Blind raters heard "a high, pitchy, ringy noise... in the right ear" on several surge clips. Root
cause was **not** patch character but an **upstream `surgepy` bug**: `getOutput()` builds its
`(2, BLOCK_SIZE)` numpy array with interleaved strides (`{2*sizeof(float), sizeof(float)}`) against a
channel-major `output[2][BLOCK_SIZE]` engine buffer, so pybind11 copies the *right* row starting two
floats in — the returned right channel is the **left channel delayed 2 samples**, spliced at every
32-sample block boundary. That comb-filters into a hard-panned-right 4-8 kHz ring on *every* surge
render (the mono-bass control was affected too). The sidecar now collects through `processMultiBlock`
(a correct per-channel `memcpy` path) instead; `ringDb` in the render metadata stays as a safety net.
Full evidence chain, before/after `ringDb`, and a draft upstream Surge XT issue:
`docs/research/surge-right-ear-ring-rootcause.md`. Diagnostic harness: `scripts/debug-surge-ring.py`.

## The ref-dir licensing stance

Ref clips are **private chops of commercial music** — the same private-data posture as the T3
dataset (`docs/taste-loop-design.md`, "Licensing note"), enforced in the tool, not just documented:

- `--ref-dir` is **opt-in and off by default**; the tool only ever **reads** under the given
  path and never modifies the originals.
- The trimmed/level-matched **working copies** a batch needs live only in that batch's dir, and
  any batch containing one gets a generated `.gitignore` (`*`) so the copies can never land in
  git even when a collection dir sits inside a repo. Prefer keeping ref-bearing collection dirs
  outside any repo anyway.
- The batch **manifest** records the origin as an absolute path — a *reference*, readable only by
  whoever already has the files.
- The **scores log** (the one artifact meant to be shared with tooling and possibly other
  machines) records the source **kind only** (`"ref"`), plus the same DSP feature vector every
  scored clip gets — never the path, title, artist, or audio.
- Nothing derived from ref audio is ever registered into a project, adopted, or redistributed —
  a clip-set batch has nothing to adopt by construction.

## How to run a round

```
beat taste-seeds ~/showdown            # once — seed songs (any existing collection dir works too)
beat showdown ~/showdown               # 4 batches (one per role) via fal; add --rounds 2 for 8
beat showdown ~/showdown --with-produced     # same, plus an engineplus clip per batch (the production ablation)
beat showdown ~/showdown --with-surge        # same, plus a Surge XT factory-patch clip per pitched batch
beat showdown --surge-doctor                 # is surgepy built? where is the factory content? (build steps if not)
beat showdown ~/showdown --ref-dir ~/chops   # same, plus a private ref clip per batch
beat rate ~/showdown                   # rate them blind in the browser, as usual
beat showdown ~/showdown --report      # the scoreboard (add --json for scripts)
```

Everything tests offline with `--gen-backend stub` (deterministic tone beds — the pipeline's
plumbing truth, no fal spend); real rounds are owner-side with `FAL_KEY` set. A round of 4
batches costs 8 engine renders (two per batch, one harness boot each — three per batch with
`--with-produced`, still one boot) plus 4–6 fal generations.
Rounds accumulate: the report reads the whole log, and per-role splits shed their smoke label at
5 batches per role (~5 rounds).

## Honesty notes

- **Phrase confound**: engine and keymap play the *seed's* phrase; gen invents its own. A gen win
  can mean "better sound" or "better notes" — accepted for v1 (the owner's question is "which
  pipeline produces sound I want to keep", notes included). The keymap-vs-engine comparison is
  clean (same phrase, different timbre), and keymap-vs-gen isolates realization from timbre.
- **Stub rounds are plumbing, not data**: stub clips are tone beds; never mix a stub round's
  scores into a log you report from. (Stub-built demo rounds live in throwaway dirs.)
- **Prep asymmetry**: gen clips pass through the one-shot prep (trim/fade/peak-normalize) before
  batch-level LUFS matching; engine/keymap renders don't need it. Batch-level normalization is
  what makes the comparison fair either way.

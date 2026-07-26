# dotbeat Python sidecar (`python/`)

This directory holds dotbeat's **first non-Node dependency**: a small Python audio-analysis
sidecar (`analyze.py`) that `beat analyze` shells out to. It exists because state-of-the-art
beat/downbeat/section detection lives in the Python ML ecosystem (torch), and dotbeat's core stays
zero-runtime-deps Node by keeping that dependency behind a process boundary and a JSON contract.

- `analyze.py` — the sidecar. Reads an audio file, prints the analysis **core** (tempo, beats,
  downbeats, sections — all in **seconds**) as JSON on stdout. Progress/chatter goes to stderr. It
  writes **no files**; the TypeScript wrapper (`src/analysis/sidecar.ts`) owns all file I/O, sha256
  caching, and the `*.analysis.json` envelope.
- `requirements-beatthis.txt` — the default backend (Beat This: beats + downbeats).
- `requirements-allin1.txt` — a **spike** backend (All-In-One: adds section labels; heavy install).

The top level of `analyze.py` imports stdlib only. The `stub` backend (deterministic 120-BPM grid)
needs **no packages at all** — that's what CI and the dev container run, so `npm test` is green with
zero Python installed. The real ML backends import lazily, so a missing package degrades cleanly to
an actionable error, never a stack trace.

## The fleet (all 8 sidecars)

`analyze.py` was the first; the same contract now carries seven more. **This table is the index —
a new sidecar adds a row here and a section below.** (Four of these were undocumented until
research/130 W0.6; the doc had stopped being updated after `roughness.py` even though D17 designates
it the shared template, so a new sidecar author reading it saw half the fleet.)

| sidecar | what it does | TS wrapper | CLI surface | requirements | venv |
|---|---|---|---|---|---|
| `analyze.py` | beats / downbeats / sections (seconds) | `src/analysis/sidecar.ts` | `beat analyze` | `-beatthis`, `-allin1` | shared |
| `gen.py` | text→audio one-shot, writes the WAV | `src/analysis/gen.ts` | `beat source gen` | `-stableaudio` | shared |
| `surge_render.py` | renders notes through a Surge XT patch, writes the WAV | `src/analysis/surge.ts` | `beat showdown --with-surge` | *(source build, no wheel)* | shared |
| `roughness.py` | Daniel–Weber time-varying roughness curve | `src/metrics/roughness.ts` | `beat lint --roughness-baseline` | `-roughness` | **`venv-roughness`** |
| `embed.py` | audio embeddings (clap/mert) + Audiobox axes (aes) | `src/taste/embeddings.ts` | `beat taste-eval` | `-clap`, `-mert`, `-aesthetics` | shared |
| `midi_extract.py` | pulls one part out of a MIDI file as a figure | `src/taste/midifig.ts` | `beat showdown --midi-dir` | `-midi` | shared |
| `stem_extract.py` | Demucs separation, keeps one stem, writes the WAV | `src/analysis/stems.ts` | `beat source gen --stem`, showdown gen arm | `-demucs` | shared |
| `ca2_figures.py` | Composer's Assistant 2 composes over our chord track | `src/taste/ca2.ts` | `beat showdown --ca2` | `-ca2` | **out-of-repo** |

Exit-code discipline is 8/8: `0` ok · `2` usage/bad input · `3` missing dependency (with a
copy-pasteable `pip install -r python/requirements-*.txt` as the **last stderr line**) · `4` failure.
All 8 implement `--doctor`. Five print their whole result as stdout JSON; `gen.py`,
`surge_render.py` and `stem_extract.py` write **binary audio** to a path they are told and print
metadata only (the one deliberate contract variation, see D19 below).

On the TypeScript side all eight wrappers now go through **one** scaffold,
`src/analysis/spawn-sidecar.ts` — one spawn, one 600 s timeout, one 64 MiB output cap, one
`resolvePython({ envVar?, dedicatedVenv?, extraCandidates? })`, one `sidecarDoctor()`. Before
research/130 W1.1 each wrapper re-declared all of it (8 copies of the constants, 7 of the spawn).
**Do not re-declare `spawnPython`/`SPAWN_TIMEOUT_MS` in a new wrapper** — import the scaffold.

## Install (owner machine)

pip is intentionally blocked in the dev/CI container, so the real backends are installed and
validated **on your own machine**. dotbeat auto-discovers a venv at `python/.venv`.

**Build the venv on Python 3.10, not your newest system Python.** `stable-audio-tools` (the
`beat source gen` backend) declares `requires-python >=3.10,<3.11` — on 3.12+ every published
version either refuses to install or fails building a wheel. Beat This has no such ceiling, so one
3.10 venv cleanly serves both sidecars (validated 2026-07-14):

```sh
brew install python@3.10           # macOS; any 3.10 interpreter works
/opt/homebrew/bin/python3.10 -m venv python/.venv
python/.venv/bin/pip install -r python/requirements-beatthis.txt
python/.venv/bin/pip install -r python/requirements-stableaudio.txt
```

That's it — zero config after. `beat analyze` resolves its interpreter in this order:

1. `$BEAT_PYTHON` (an explicit override — point it at any interpreter you like)
2. `<repo>/python/.venv/bin/python3` if it exists (the auto-discovered venv above)
3. `python3` on `PATH`

The resolved interpreter path is printed by `beat analyze --doctor` and in every degrade message,
so you always know which Python ran.

> All pins in both requirements files were confirmed owner-side on 2026-07-14 against live
> PyPI/GitHub/HF, and each non-obvious line (the `soundfile` fallback Beat This silently needs, the
> `PyWavelets`/numpy-2 ABI fix, the undeclared `pytorch_lightning` import) carries a comment
> explaining exactly what breaks without it — read those before "simplifying" the files.

## Owner-side validation checklist

The dev container exercises all the plumbing through the `stub` backend, but the real model can
only be validated where torch is installed. After `pip install`, run through this once:

1. **Install the venv** — the two commands above.
2. **Doctor** — `beat analyze --doctor`. Confirm `beatthis` reports `ok: true` (no missing
   modules) and the interpreter path points at `python/.venv/bin/python3`.
3. **Analyze a real track** — `beat analyze path/to/song.wav` (defaults to `--backend beatthis`).
   It writes `path/to/song.analysis.json` and prints the detected bpm (+ method), beat/downbeat
   counts, and sections.
4. **Eyeball the numbers** — does the reported bpm match what you'd tap? Do the section
   count/placements look sane for that track? (Beat This emits no sections — the skeleton loader
   chunks the beat grid into parts; All-In-One's boundaries are trustworthy, its labels are not.)
5. **Skeleton** — `beat skeleton out.beat song.analysis.json` scaffolds a structure-matched empty
   `.beat`. Confirm it opens and its song block matches the sections.

## Conventions shared with `beat source gen` (Phase 39)

The spawn/JSON/doctor/venv conventions here are deliberately generic. `python/gen.py` (Stable Audio
Open text-to-audio, Phase 39 `beat source gen`) reuses them verbatim: stdlib-only top level with
lazy backend imports; chatter on stderr; exit codes `0/2/3/4` with a copy-pasteable
`pip install -r ...` as the last stderr line on a missing dependency; the same `$BEAT_PYTHON` →
`python/.venv` → `python3` interpreter resolution; and a `--doctor` mode probing deps with
`importlib.util.find_spec` (which never executes the module).

**The ONE contract variation:** analysis emits its whole result as stdout JSON and writes no files,
but generation produces **binary audio**, so `gen.py` **writes the generated WAV to the `--output`
path it is told** and prints only a small JSON **metadata** doc on stdout
(`{backend, provider, model, seconds, seed, sampleRate}`). The TypeScript side
(`src/analysis/gen.ts`) plus `scripts/source-lib.mjs` own registration, the enforced provenance
sidecar, and rollback — `gen.py` knows nothing about dotbeat's media block. See decisions.md D19.

- `gen.py` — argv `--backend <stub|stableaudio> --prompt "<text>" --seconds <N> --seed <N>
  --output <wav>` (or `--doctor`). The stdlib-only `stub` backend writes a **deterministic**
  seed-derived 44.1 kHz stereo 16-bit WAV of the requested duration (byte-identical for a fixed
  seed+seconds — it does not interpret the prompt, it just proves the pipeline). The `stableaudio`
  backend lazily imports `stable_audio_tools` + `torch` and runs **Stable Audio Open 1.0** locally.
- `requirements-stableaudio.txt` — `torch` + `stable-audio-tools` plus two pins that fix real
  breakage (`PyWavelets>=1.6` for the numpy-2 ABI, `pytorch-lightning` for an undeclared import in
  stable-audio-tools' inference path). All pins and the HF weights repo id
  (`stabilityai/stable-audio-open-1.0`, gated) confirmed owner-side 2026-07-14.

### Install + validate `beat source gen` (owner machine)

Same auto-discovered `python/.venv` (built on **Python 3.10** — see Install above). The model
weights are **gated on Hugging Face** and downloaded lazily on the first real run (~2 GB):

1. While logged into your HF account, open
   <https://huggingface.co/stabilityai/stable-audio-open-1.0> and accept the license
   ("Agree and access repository").
2. `python/.venv/bin/hf auth login` and paste a token from
   <https://huggingface.co/settings/tokens> (read scope is enough).

```sh
python/.venv/bin/pip install -r python/requirements-stableaudio.txt
beat source gen --doctor                       # confirm stableaudio reports ok:true
beat source gen song.beat pad "warm analog pad" --seconds 3 --seed 7   # a real one-shot
```

Runtime expectations (measured 2026-07-14, M-series CPU, no CUDA): ~2 min per 3-second one-shot at
the model's 250 diffusion steps — plan generation batches accordingly. Generation is deterministic
for a fixed prompt/seed/seconds **on the same machine/torch build**: regenerating through
`beat source gen` reproduces the registered file byte-for-byte (sha256-verified), which is what
makes a fully-generated project a *recipe* — `examples/recipe-song/` is the worked proof.
Cross-machine bit-reproducibility is not guaranteed (different BLAS/threading).

`beat source gen … --backend stub` runs everywhere with zero packages (the CI/dev path) and writes
a deterministic tone bed so the registration/provenance plumbing is exercised without the model.

### License + attribution (Stable Audio Open)

Stable Audio Open 1.0 ships under the **Stability AI Community License**
(<https://stability.ai/community-license-agreement>): research and non-commercial use are free, and
**commercial** use is free for individuals/orgs under **$1M annual revenue** provided you register a
Community License with Stability (the license terminates above $1M, where an Enterprise license is
required). You **own** the generated outputs, and the license's distribution/attribution obligations
attach to the **model/Materials**, not to the individual output `.wav` files — so committing
generated one-shots into a public `.beat` project's `media/` folder is clean (research 103, D19).

> **Powered by Stability AI.** dotbeat carries this attribution as the tool-integration obligation
> for wrapping Stable Audio Open; the per-output files themselves need no attribution.

## Surge XT render sidecar (`beat showdown --with-surge`)

`surge_render.py` is the fourth sibling on this template (source-showdown probe B1, research 114
§7 "Surge-as-sound-factory"). It renders a note sequence through a **Surge XT factory patch** via
the `surgepy` bindings and writes a WAV — the `surge` showdown source. Same conventions as the
others: stdlib-only top level with a lazy `surgepy` import, chatter on stderr, exit codes
`0/2/3/4`, a `--doctor` mode that probes with `importlib.util.find_spec` (no import), and the same
`$BEAT_PYTHON` → `python/.venv` → `python3` interpreter resolution (via `src/analysis/surge.ts`).

Modes: `--doctor` (surgepy availability + Surge factory-content path + factory patch count),
`--list-patches` (the factory catalogue as JSON, for the TS-side seeded pick), `--dump-params
<patch>` (every parameter with its **native** value + range — what preset retargeting needs to
start a local search AT a preset), and the default **render** mode — the request JSON
`{patch, notes, sampleRate, output}` comes in on **stdin**, the WAV is written to `output`, and a
small metadata doc is printed on stdout.

### Two override spellings, and why (2026-07-26)

The render request accepts `overrides` **and** `nativeOverrides`. `overrides` is the original
Track 1a surface, documented and validated as normalized `0..1` — but `surgepy.setParamVal` takes a
parameter's **native** value, so on this build that path can only ever reach the `0..1` slice of a
parameter's real range. Measured on `Basses/Theme.fxp`: `A Filter 1 Cutoff` spans `-60..70`
(13.75 Hz … 14 kHz) and the `0..1` window reaches **440.00 … 466.16 Hz**. Parameters whose native
range happens to *be* `0..1` (resonance, EG sustain) were unaffected, which is how it went unnoticed.

`overrides` is deliberately left as-is — redefining it would silently reinterpret every render
already cached against it (`cli/surge-render-prep.mjs` hashes the override list into its cache key).
`nativeOverrides` is the additive path: values in Surge's own units, clamped to each parameter's
reported `[min, max]`, echoed back as `{param, requested, applied, min, max, display}`. Prefer it
for anything that needs real range coverage. See `docs/preset-retargeting.md`.

### surgepy is NOT pip-installable — it's a Surge XT source build

Confirmed owner-side **2026-07-21**: `pip install surgepy` → *"ERROR: No matching distribution
found for surgepy"*. There is **no PyPI wheel** (nor under `surge-synthesizer`, `surge-python`,
etc.). `surgepy` exists only as a compiled module produced by building **Surge XT itself** from
source with its Python bindings enabled. The honest build path (macOS; needs `cmake` + a C++
toolchain — both present on the owner machine):

```sh
git clone --recurse-submodules https://github.com/surge-synthesizer/surge
cd surge
cmake -Bbuild -DSURGE_BUILD_PYTHON_BINDINGS=TRUE
cmake --build build --config Release --target surgepy
# the built surgepy module lands under build/ — put it on PYTHONPATH, e.g. copy it into
#   python/.venv/lib/python3.10/site-packages/   (or export PYTHONPATH=<...>/surge/build)
```

This is a full C++ build of a complete synthesizer (tens of minutes, hundreds of MB of submodules
including JUCE) and it installs Surge's factory content (patches + wavetables). It was **not**
completed in the B1 probe — the probe ships with `--surge-doctor` honest about what's missing so
the feature is usable the moment someone does the build. Validate afterwards:

```sh
beat showdown --surge-doctor          # expect surgepy: available, a factory path, a patch count (~2,779)
beat showdown ~/showdown --with-surge # add a Surge factory-patch clip per pitched-role batch
```

### License (Surge XT)

Surge XT is **GPLv3** — fine as a **local dev-side render tool** (mere aggregation; rendered audio
carries no code copyleft), never linked into a shippable dotbeat build. The **factory-patch
_content_ license is unresolved upstream** (surge issue #6741), so surge renders stay eval-private:
the showdown gitignore-gates any batch that contains a surge clip, the shared scores log records
the source kind only, and nothing derived from a surge render is ever registered or redistributed.
Re-check #6741 before publishing any Surge-rendered clip.

## Roughness sidecar (`beat lint --roughness-baseline`)

`python/roughness.py` computes Daniel & Weber time-varying psychoacoustic roughness (via **MoSQITo**,
Apache-2.0) — research 123's verdict: the only measured signal that tracks the owner's "grindy"
complaint, usable **only pair-relative** (there is no valid absolute threshold — commercial material
out-roughs the flagged defect). It reads one WAV, collapses to the channel-mean, and prints the
binned roughness curve (3 s bins) plus overall `mean`/`p95` on stdout. The TS wrapper
(`src/metrics/roughness.ts`) does the pair-relative comparison; `beat lint <candidate.wav> --screens
--roughness-baseline <baseline.wav>` wires it into the pathology screens.

**Use a DEDICATED venv, `python/venv-roughness`.** MoSQITo pins `numpy<2` transitively, which can
fight the shared `python/.venv` (stable-audio / Beat This). The sidecar auto-discovers its own venv,
so keep it separate:

```sh
/opt/homebrew/bin/python3.10 -m venv python/venv-roughness
python/venv-roughness/bin/pip install -r python/requirements-roughness.txt
python/venv-roughness/bin/python3 python/roughness.py --doctor   # {"available": true, ...}
```

`beat lint --roughness-baseline` resolves its interpreter in this order (distinct from the analysis
chain so the two venvs never collide):

1. `$BEAT_ROUGHNESS_PYTHON` (explicit override)
2. `<repo>/python/venv-roughness/bin/python3` (the dedicated venv above)
3. `$BEAT_PYTHON`, then `<repo>/python/.venv/bin/python3`, then `python3` (shared fallbacks — fine if
   MoSQITo happens to install cleanly alongside the other sidecars)

A missing sidecar degrades cleanly: `beat lint` prints a one-line "roughness: SKIPPED" note and the
rest of the run is unaffected (roughness is a pair-relative advisory, never a hard precondition).
`roughness.py` follows the same contract as the others (stdlib-only top level, lazy MoSQITo import,
exit `0/2/3/4` with a `pip install -r python/requirements-roughness.txt` fix line on a missing dep).

## Embedding + aesthetics sidecar (`beat taste-eval`)

`python/embed.py` turns one audio file into a feature vector for the taste model. Five backends
behind one flag, all lazily imported:

- `aes` — **Audiobox-Aesthetics** (facebook/audiobox-aesthetics, CC-BY-4.0): four crowd-trained
  NAMED axes, CE content enjoyment / CU content usefulness / PC production complexity / PQ
  production quality. This is the **endorsed** representation (research/122 §5) and the default of
  `embedAudioFile`. Deps: `requirements-aesthetics.txt`.
- `aes-stub` — deterministic plumbing-truth axes, no torch, so the whole aes path tests everywhere.
- `clap` — LAION-CLAP `larger_clap_music`, 512-d (Apache-2.0). **RETIRED**: it scored *below
  chance* on held-out owner picks at n=37 and was killed at the T1 gate. Kept selectable to
  reproduce old runs only. Deps: `requirements-clap.txt`.
- `mert` — MERT-v1-330M (CC-BY-NC weights, personal use only). Implemented and pinned but **no
  caller anywhere selects it** — untried, same caveat as CLAP.
- `stub` — deterministic, dependency-free.

```sh
python/embed.py --backend aes --input clip.wav [--model M]   # or --doctor
```

stdout is `{backend, model, dims, embedding: [...]}`. The TS side (`src/taste/embeddings.ts`)
caches the result **next to the audio** keyed by `sha256 + backend + model`, in
`<file>.embedding.json` for the vector backends and `<file>.aesthetics.json` for aes — two files
because taste-eval runs an embedding backend and an aes backend over the same wavs in one pass and
a shared cache would thrash. `beat taste-eval --doctor` prints the readiness report.

Note `embed.py` hard-exits after printing its one JSON line, deliberately: a lingering
huggingface_hub thread could otherwise block teardown, and it loads `local_files_only` first so a
flaky hub connection can never park the sidecar in an SSL retry loop.

## MIDI figure sidecar (`beat showdown --midi-dir`)

`python/midi_extract.py` (via **mido**, MIT) reads a `.mid` file and extracts ONE part as a 4- or
8-bar figure the showdown can render as a clip — the third figure source beside the archetype bank
and the theory layer.

```sh
python/midi_extract.py --input song.mid --part bass|chords|lead --bars 4|8
python/midi_extract.py --scan --input song.mid     # classify every voice in the file
python/midi_extract.py --doctor                    # probe mido
```

stdout is the figure (notes as `{pitch, start, duration, velocity}` on a 16th grid plus the part
classification). Validation is the TS side's (`validateMidiFigure`) and it is deliberately strict:
a malformed payload must fail with a specific message, never as NaN pitches at render time.
Deps: `requirements-midi.txt` (mido only — no torch, installs in seconds).

**Third-party content posture:** MIDI files you point `--midi-dir` at are yours to license; the
figures they produce carry the `midi:` label prefix in the batch manifest, and the scores log
records only that label, never the source path.

## Stem-extraction sidecar (`beat source gen --stem`, showdown gen arm)

`python/stem_extract.py` separates a mix with **Demucs** (`htdemucs`, MIT) and keeps exactly one of
`bass | other | drums | vocals`, writing it as a 16-bit 44.1 kHz WAV. It exists because Lyria is a
full-track model — a "solo bassline" prompt reliably returns a band — and three escalating
prompt-side attempts failed, so the guarantee comes from extraction instead.

```sh
python/stem_extract.py --input mix.wav --stem bass --output stem.wav \
  [--model htdemucs] [--device auto|cpu|mps|cuda] [--silence-margin-db 25]
python/stem_extract.py --doctor
```

Writes the audio, prints metadata only: the model/device, the stem asked for, the stem actually
written, and RMS dBFS for the mix, the kept stem and the residual. A **near-silence guard** fires
when the requested stem sits more than `--silence-margin-db` below the mix — it substitutes the
loudest stem and says so in `fallback`/`stemUsed` rather than shipping silence. `--device cpu` is
the default because its numerics are stable.

The TS wrapper (`src/analysis/stems.ts`) throws on ANY failure — deliberately NOT the
degrade-and-continue posture roughness takes, because silently shipping the full mix would poison a
blind eval far more quietly than a loud failure does. Its interpreter chain adds one step:
`$BEAT_STEM_PYTHON` → `$BEAT_PYTHON` → shared venv → `python3`. There is no dedicated venv (demucs
shares the venv's torch happily). Deps: `requirements-demucs.txt`.

## CA2 figure sidecar (`beat showdown --ca2`)

`python/ca2_figures.py` runs **Composer's Assistant 2** (Malandro, ISMIR 2024; MIT code,
public-domain/permissive training MIDI) as a note generator over a chord track *we* decide. The
division of labour is the point: our theory layer picks key, progression, register and density; CA2
proposes notes; our guards (bass register, snap-to-scale, the pre-render lint) have the last word,
and every correction is counted into the batch's provenance.

```sh
echo '<request json>' | python/ca2_figures.py --request -    # request on STDIN
python/ca2_figures.py --doctor      # probe checkout + weights + packages
python/ca2_figures.py --smoke       # --doctor plus one tiny real generation
```

The request/response contract is versioned: `CONTRACT_VERSION` (currently 1) is echoed in the
payload as `contract` and the TS side refuses a mismatch loudly rather than misreading a skewed
payload. (Note the field is named `contract`/`CONTRACT_VERSION` here where the other stdout-JSON
sidecars use `version` — harmless today, worth knowing if a cache is ever keyed on it.)

**The install lives OUTSIDE the repo** — CA2's checkout and its 716 MB release weights, plus its own
python3.10 venv, behind two env vars:

1. `BEAT_CA2_DIR` → CA2's `Scripts/composers_assistant_v2` directory
2. `BEAT_CA2_PYTHON` → a venv python with `requirements-ca2.txt` installed

`beat showdown --ca2-doctor` prints the full readiness report. The interpreter chain is
`$BEAT_CA2_PYTHON` → a couple of known out-of-repo `amt-venv` locations → the shared chain.
`requirements-ca2.txt` pins `transformers<4.50`, which caps the ceiling for the whole shared venv —
watch it when bumping the other ML sidecars.

## Contract summary (for anyone editing `analyze.py`)

```
argv:   --backend <stub|beatthis|allin1> --input <abs audio path>   (analysis)
        --doctor                                                    (dependency probe)
stdout: {"backend": {"name","version","model"}, "bpm": <float|null>,
         "beats": [...seconds], "downbeats": [...seconds],
         "sections": [{"start","end","label"}]}
exit:   0 ok · 2 usage/bad input · 3 missing dependency · 4 analysis failure
```

`bpm` may be `null` (Beat This has no tempo) — the TS wrapper then derives it from the median
inter-beat interval and records `bpmMethod: "median-ibi"`. `sections` may be empty (a beats-only
backend). Never write to stdout except the single JSON document.

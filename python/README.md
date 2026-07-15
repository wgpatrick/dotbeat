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

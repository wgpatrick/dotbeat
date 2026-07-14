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
validated **on your own machine**. dotbeat auto-discovers a venv at `python/.venv`:

```sh
python3 -m venv python/.venv
python/.venv/bin/pip install -r python/requirements-beatthis.txt
```

That's it — zero config after. `beat analyze` resolves its interpreter in this order:

1. `$BEAT_PYTHON` (an explicit override — point it at any interpreter you like)
2. `<repo>/python/.venv/bin/python3` if it exists (the auto-discovered venv above)
3. `python3` on `PATH`

The resolved interpreter path is printed by `beat analyze --doctor` and in every degrade message,
so you always know which Python ran.

> **`requirements-beatthis.txt` pins `beat_this` to a git commit sha that is a placeholder** (the
> build container can't reach GitHub to verify it). Confirm/replace it against
> <https://github.com/CPJKU/beat_this> before your first real run, then re-run
> `beat analyze --doctor`.

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
- `requirements-stableaudio.txt` — `torch` + `stable-audio-tools`. **Version pins and the HF weights
  repo id (`stabilityai/stable-audio-open-1.0`) are PLACEHOLDERS to confirm owner-side** (HF/PyPI
  unreachable from the build container, mirroring `requirements-beatthis.txt`'s commit-sha caveat).

### Install + validate `beat source gen` (owner machine)

Same auto-discovered `python/.venv`; the model weights are gated on Hugging Face (accept the license
and `huggingface-cli login` first) and are ~a couple GB, downloaded lazily on the first real run.

```sh
python3 -m venv python/.venv
python/.venv/bin/pip install -r python/requirements-stableaudio.txt
beat source gen --doctor                       # confirm stableaudio reports ok:true
beat source gen song.beat pad "warm analog pad" --seconds 3 --seed 7   # a real one-shot
```

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

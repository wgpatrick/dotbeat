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

The spawn/JSON/doctor/venv conventions here are deliberately generic. A future `python/gen.py`
(Stable Audio Open text-to-audio, Phase 39 `beat source gen`) reuses them verbatim at zero cost:
stdlib-only top level with lazy backend imports; one JSON document on stdout, chatter on stderr;
exit codes `0/2/3/4` with a copy-pasteable `pip install -r ...` as the last stderr line on a
missing dependency; the same `$BEAT_PYTHON` → `python/.venv` → `python3` interpreter resolution;
and a `--doctor` mode probing deps with `importlib.util.find_spec` (which never executes the
module). Copy the shape, add a `requirements-<backend>.txt`, done.

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

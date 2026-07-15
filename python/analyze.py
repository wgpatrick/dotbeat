#!/usr/bin/env python3
"""dotbeat audio-analysis sidecar (Phase 38 Stream SB, docs/phase-38-plan.md).

This is the project's FIRST non-Node dependency, isolated behind a stdout-JSON contract so the
Node side (src/analysis/sidecar.ts) knows nothing about torch and this file knows nothing about
dotbeat. It reads an audio file, detects tempo / beats / downbeats / sections, and prints the
analysis CORE as JSON on stdout. All progress/model chatter goes to stderr. It writes NO files —
the TS wrapper owns every byte of file I/O (sha256, envelope, atomic temp+rename).

CONTRACT (frozen in docs/phase-38-plan.md):
  argv:  --backend <stub|beatthis|allin1> --input <abs wav path>   (analysis)
         --doctor                                                  (dependency probe)
  stdout: {"backend": {"name","version","model"}, "bpm": <float|null>,
           "beats": [...seconds], "downbeats": [...seconds],
           "sections": [{"start","end","label"}]}   -- seconds throughout; NO bars here.
  exit:  0 ok · 2 usage/bad input · 3 missing dependency · 4 analysis failure.
         On exit 3 the LAST stderr line is a copy-pasteable `pip install -r ...` fix.

Top-level imports are stdlib ONLY. Backend deps (torch, beat_this, allin1) are imported LAZILY
inside run_beatthis()/run_allin1() so `--backend stub` and `--doctor` work with zero packages
installed (the reality of this container and CI). The spawn/JSON/doctor/venv conventions here are
SHARED with a future python/gen.py (Phase 39 `beat source gen`) — keep them boring and copyable.
"""

import argparse
import contextlib
import importlib.util
import json
import os
import sys
import wave

# Backends whose deps live in a requirements-<name>.txt (for the exit-3 fix line + --doctor probe).
BACKEND_REQUIREMENTS = {
    "beatthis": "python/requirements-beatthis.txt",
    "allin1": "python/requirements-allin1.txt",
}
# The stub is pure-stdlib and always available; version is a fixed string so tests can assert it.
STUB_VERSION = "0.1.0"


class UsageError(Exception):
    """Bad/unreadable/unsupported input or argv — exit 2."""


class DependencyError(Exception):
    """A backend's Python deps aren't installed — exit 3. `requirements` names the fix file."""

    def __init__(self, message, requirements):
        super().__init__(message)
        self.requirements = requirements


class AnalysisError(Exception):
    """The backend ran but failed to produce a usable result — exit 4."""


def log(*parts):
    """Progress/chatter — stderr ONLY (stdout is reserved for the one JSON document)."""
    print(*parts, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------------------------
# stub backend — deterministic, stdlib-only. Exercises the ENTIRE plumbing (spawn, JSON, cache,
# envelope) with no model, so `npm test` is green with zero Python packages. Given the same input
# file it emits byte-identical numbers, so tests assert exact values.
# ---------------------------------------------------------------------------------------------

_STUB_BPM = 120.0
_STUB_BEAT_INTERVAL = 60.0 / _STUB_BPM  # 0.5 s at 120 BPM
_STUB_BEATS_PER_BAR = 4  # downbeat every 4th beat
# Fixed section cut points as fractions of duration: intro 0-15%, loop 15-85%, outro 85-100%.
_STUB_SECTIONS = (("intro", 0.0, 0.15), ("loop", 0.15, 0.85), ("outro", 0.85, 1.0))


def wav_duration_seconds(input_path):
    """Duration of a PCM WAV via the stdlib `wave` module (16-bit PCM is what dotbeat renders)."""
    try:
        with contextlib.closing(wave.open(input_path, "rb")) as w:
            frames = w.getnframes()
            rate = w.getframerate()
    except wave.Error as e:
        raise UsageError(f"not a readable PCM WAV file: {input_path} ({e})")
    except EOFError as e:
        raise UsageError(f"truncated/empty WAV file: {input_path} ({e})")
    if rate <= 0:
        raise UsageError(f"WAV reports a non-positive sample rate: {input_path}")
    return frames / float(rate)


def run_stub(input_path):
    duration = wav_duration_seconds(input_path)
    if duration <= 0:
        raise UsageError(f"WAV has zero duration: {input_path}")

    # 120 BPM grid: a beat at every 0.5 s strictly BEFORE the end of the file.
    num_beats = int(duration / _STUB_BEAT_INTERVAL)
    beats = [round(i * _STUB_BEAT_INTERVAL, 6) for i in range(num_beats)]
    downbeats = [beats[i] for i in range(0, num_beats, _STUB_BEATS_PER_BAR)]

    sections = [
        {"start": round(duration * lo, 6), "end": round(duration * hi, 6), "label": label}
        for (label, lo, hi) in _STUB_SECTIONS
    ]

    return {
        "backend": {"name": "stub", "version": STUB_VERSION, "model": None},
        "bpm": _STUB_BPM,  # reported → TS sets bpmMethod "backend"
        "beats": beats,
        "downbeats": downbeats,
        "sections": sections,
    }


# ---------------------------------------------------------------------------------------------
# beatthis backend — Beat This (CPJKU). Beats + downbeats, NO tempo (the model has none), NO
# sections (beats-only, honest empty list). TS derives bpm from the median inter-beat interval.
# torch is absent in this container, so this path can't run here; it's written to be obviously
# correct and is exercised owner-side (see python/README.md's validation checklist).
# ---------------------------------------------------------------------------------------------


def run_beatthis(input_path):
    log("beatthis: loading torch + beat_this (first run may download the model)...")
    try:
        import torch  # noqa: F401  (imported for its side effect of proving CPU/CUDA availability)
        from beat_this.inference import File2Beats
    except ImportError as e:
        raise DependencyError(
            f"Beat This backend unavailable ({e}).",
            BACKEND_REQUIREMENTS["beatthis"],
        )

    # File2Beats loads the checkpoint once and, called on an audio path, returns two arrays of
    # times in SECONDS: beat instants and the subset that are downbeats. "cpu"/"final0" are the
    # portable defaults; owner-side a CUDA device speeds this up. dbn=False uses the fast postproc.
    try:
        device = "cuda" if _cuda_available() else "cpu"
        log(f"beatthis: running on {device}")
        file2beats = File2Beats(checkpoint_path="final0", device=device, dbn=False)
        beats, downbeats = file2beats(input_path)
    except Exception as e:  # model/inference failure is exit 4, distinct from a missing dep (3).
        raise AnalysisError(f"Beat This inference failed: {e}")

    return {
        # bpm is null on purpose: Beat This detects beats, not tempo — the TS wrapper computes it
        # from the median inter-beat interval and records bpmMethod "median-ibi".
        "backend": {"name": "beatthis", "version": _beatthis_version(), "model": "final0"},
        "bpm": None,
        "beats": _to_seconds_list(beats),
        "downbeats": _to_seconds_list(downbeats),
        "sections": [],  # beats-only backend — the skeleton loader chunks these into parts.
    }


def _cuda_available():
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _beatthis_version():
    try:
        import beat_this

        return str(getattr(beat_this, "__version__", "unknown"))
    except Exception:
        return "unknown"


def _to_seconds_list(arr):
    """Backends may return numpy arrays; normalize to a plain sorted list of finite float seconds."""
    out = []
    for x in list(arr):
        v = float(x)
        if v == v and v != float("inf") and v != float("-inf"):  # drop NaN/inf
            out.append(round(v, 6))
    out.sort()
    return out


# ---------------------------------------------------------------------------------------------
# allin1 backend — SPIKE (research 102: All-In-One's boundaries are trustworthy but its labels are
# weak on electronic material, and the install is heavy: NATTEN + madmom-from-git). Lazily imported,
# clearly unverified. Maps its segments -> sections; beats/downbeats from its result. Owner-side
# only; do not rely on the labels — trust the boundaries.
# ---------------------------------------------------------------------------------------------


def run_allin1(input_path):
    log("allin1: loading (SPIKE path — heavy install, labels unverified on electronic material)...")
    try:
        import allin1
    except ImportError as e:
        raise DependencyError(
            f"All-In-One backend unavailable ({e}).",
            BACKEND_REQUIREMENTS["allin1"],
        )

    try:
        result = allin1.analyze(input_path)  # returns an AnalysisResult dataclass
    except Exception as e:
        raise AnalysisError(f"All-In-One analysis failed: {e}")

    # result.segments: list of Segment(start, end, label); result.beats / result.downbeats: seconds.
    sections = []
    for seg in getattr(result, "segments", []) or []:
        start = float(getattr(seg, "start"))
        end = float(getattr(seg, "end"))
        if end > start:
            sections.append(
                {"start": round(start, 6), "end": round(end, 6), "label": getattr(seg, "label", None)}
            )

    bpm = getattr(result, "bpm", None)
    return {
        "backend": {"name": "allin1", "version": str(getattr(allin1, "__version__", "unknown")), "model": "harmonix-all"},
        "bpm": float(bpm) if isinstance(bpm, (int, float)) else None,
        "beats": _to_seconds_list(getattr(result, "beats", []) or []),
        "downbeats": _to_seconds_list(getattr(result, "downbeats", []) or []),
        "sections": sections,
    }


BACKENDS = {"stub": run_stub, "beatthis": run_beatthis, "allin1": run_allin1}


# ---------------------------------------------------------------------------------------------
# --doctor — dependency probe. Uses importlib.util.find_spec, which locates a module WITHOUT
# importing/executing it (so probing torch never actually loads torch — safe and fast). stub is
# always ok. Prints JSON on stdout so the TS side can render a readable report.
# ---------------------------------------------------------------------------------------------

# Modules each backend needs, in the order they matter for the "missing" list.
_BACKEND_MODULES = {
    "beatthis": ("torch", "beat_this"),
    "allin1": ("allin1", "natten", "madmom"),
}


def _has_module(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        # A parent package that itself fails to import can raise here; treat as "not available".
        return False


def doctor():
    backends = {"stub": {"ok": True}}
    for name, modules in _BACKEND_MODULES.items():
        missing = [m for m in modules if not _has_module(m)]
        backends[name] = {"ok": len(missing) == 0, "missing": missing}
    return {"python": sys.version.split()[0], "backends": backends}


# ---------------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------------


def parse_args(argv):
    p = argparse.ArgumentParser(prog="analyze.py", description="dotbeat audio-analysis sidecar")
    p.add_argument("--backend", choices=sorted(BACKENDS.keys()))
    p.add_argument("--input")
    p.add_argument("--doctor", action="store_true")
    return p.parse_args(argv)


def main(argv):
    args = parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0

    if not args.backend:
        raise UsageError("missing --backend (one of: stub, beatthis, allin1) or --doctor")
    if not args.input:
        raise UsageError("missing --input <audio path>")
    if not os.path.isfile(args.input):
        raise UsageError(f"input file does not exist: {args.input}")

    core = BACKENDS[args.backend](args.input)
    # stdout gets exactly one line: the analysis core. Nothing else may touch stdout.
    print(json.dumps(core))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UsageError as e:
        log(f"error: {e}")
        sys.exit(2)
    except DependencyError as e:
        log(f"error: {e}")
        # LAST stderr line is the copy-pasteable fix (TS surfaces it verbatim + a --doctor hint).
        log(f"pip install -r {e.requirements}")
        sys.exit(3)
    except AnalysisError as e:
        log(f"error: {e}")
        sys.exit(4)
    except KeyboardInterrupt:
        sys.exit(130)

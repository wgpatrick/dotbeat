#!/usr/bin/env python3
"""dotbeat time-varying roughness ("grind") sidecar (research 123 §5, doc-122 §7 schema).

A sibling on the analyze.py/embed.py template: turn ONE audio file into a time-varying
psychoacoustic-roughness curve, binned to a fixed grid, plus overall mean/p95. Pure function of its
inputs; knows nothing about dotbeat. The MODEL is Daniel & Weber time-varying roughness via MoSQITo
(Apache-2.0) — research 123's verdict: the only candidate that tracks the owner's "grindy" complaint,
and only PAIR-RELATIVE (there is NO valid absolute threshold; commercial material out-roughs the
defect). So this sidecar just reports the numbers; the TS wrapper does the pair-relative comparison.

CONTRACT (mirrors embed.py):
  argv:  --input <audio.wav> [--bin-seconds 3.0]
         --doctor                                             (dependency probe)
  stdout: {"backend","version","model","binSeconds","sampleRate","durationSeconds",
           "mean","p95","bins":[{"index","start","end","roughness"}]}   -- one JSON line.
  exit:  0 ok · 2 usage/bad input · 3 missing dependency · 4 computation failure.
         On exit 3 the LAST stderr line is a copy-pasteable `pip install -r ...` fix.

Determinism: roughness_dw is a deterministic DSP transform; identical input bytes → identical JSON.
Channels are collapsed to the channel-mean (mono) before analysis, per research 123.

Top-level imports are stdlib ONLY (analyze.py/embed.py convention); mosqito/soundfile are lazy.
"""

import argparse
import importlib.util
import json
import math
import os
import struct
import sys
import wave

REQUIREMENTS = "python/requirements-roughness.txt"
VERSION = "1.0.0"
MODEL = "mosqito-daniel-weber-roughness"
DEFAULT_BIN_SECONDS = 3.0
DEPS = ("mosqito", "numpy")  # soundfile is optional (stdlib wave fallback for 16-bit PCM)


class UsageError(Exception):
    """Bad/unsupported argv or parameters — exit 2."""


class DependencyError(Exception):
    """A backend's Python deps aren't installed — exit 3."""


class RoughnessError(Exception):
    """The computation ran but failed to produce a usable result — exit 4."""


def _read_wav_stdlib(path):
    """Decode a 16-bit PCM WAV to a channel-mean float list + sample rate (stdlib fallback)."""
    try:
        with wave.open(path, "rb") as w:
            channels = w.getnchannels()
            width = w.getsampwidth()
            rate = w.getframerate()
            frames = w.readframes(w.getnframes())
    except (wave.Error, OSError) as e:
        raise RoughnessError(f"could not read WAV {path}: {e}")
    if width != 2:
        raise RoughnessError(f"{path}: stdlib decoder needs 16-bit PCM (got {8 * width}-bit) — install soundfile in the roughness venv for other formats")
    count = len(frames) // 2
    samples = struct.unpack(f"<{count}h", frames[: count * 2])
    if channels > 1:
        mono = [sum(samples[i : i + channels]) / channels / 32768.0 for i in range(0, count - channels + 1, channels)]
    else:
        mono = [s / 32768.0 for s in samples]
    if not mono:
        raise RoughnessError(f"{path}: no audio frames")
    return mono, rate


def _load_mono(path):
    """Channel-mean float array + sample rate. Prefer soundfile (any format), fall back to stdlib
    wave for 16-bit PCM so the sidecar still runs when soundfile isn't installed."""
    import numpy as np  # noqa: PLC0415

    if importlib.util.find_spec("soundfile") is not None:
        import soundfile as sf  # noqa: PLC0415

        try:
            data, rate = sf.read(path, always_2d=True)
        except Exception as e:
            raise RoughnessError(f"could not read audio {path}: {e}")
        mono = np.asarray(data, dtype=float).mean(axis=1)
    else:
        mono_list, rate = _read_wav_stdlib(path)
        mono = np.asarray(mono_list, dtype=float)
    if mono.size == 0:
        raise RoughnessError(f"{path}: no audio frames")
    return mono, int(rate)


def run(input_path, bin_seconds):
    """Compute the DW time-varying roughness curve, bin it, and summarize mean/p95."""
    for mod in DEPS:
        if importlib.util.find_spec(mod) is None:
            raise DependencyError(f"missing Python package '{mod}' for the roughness sidecar")
    import contextlib  # noqa: PLC0415

    import numpy as np  # noqa: PLC0415

    # MoSQITo may print progress/warnings; keep the JSON-only stdout channel clean (embed.py fix).
    with contextlib.redirect_stdout(sys.stderr):
        from mosqito.sq_metrics import roughness_dw  # noqa: PLC0415

    mono, rate = _load_mono(input_path)
    duration = len(mono) / rate
    if duration < 0.3:
        raise RoughnessError(f"{input_path}: {duration:.3f}s is too short for roughness analysis (needs >= 0.3s)")

    try:
        with contextlib.redirect_stdout(sys.stderr):
            out = roughness_dw(mono, rate, overlap=0.5)
    except Exception as e:
        raise RoughnessError(f"roughness_dw failed: {e}")
    # roughness_dw returns (R, R_specific, bark_axis, time_axis); R is the time-varying curve.
    R = np.ravel(np.asarray(out[0], dtype=float))
    time_axis = np.ravel(np.asarray(out[-1], dtype=float))
    if R.size == 0 or time_axis.size != R.size:
        raise RoughnessError("roughness_dw returned an empty or mismatched curve")

    # Bin the curve onto a fixed grid: bin index = floor(frame_time / bin_seconds). Each bin's
    # roughness is the mean of the frames whose center time falls in it; an empty bin reads 0.0 so
    # bin indices stay aligned between two files of the same length (the pair-relative comparison
    # matches bins by index).
    nbins = int(math.ceil(max(float(time_axis[-1]), duration) / bin_seconds))
    nbins = max(nbins, 1)
    sums = [0.0] * nbins
    counts = [0] * nbins
    for t, r in zip(time_axis, R):
        b = min(int(t / bin_seconds), nbins - 1)
        sums[b] += float(r)
        counts[b] += 1
    bins = []
    for i in range(nbins):
        bins.append(
            {
                "index": i,
                "start": round(i * bin_seconds, 4),
                "end": round(min((i + 1) * bin_seconds, duration), 4),
                "roughness": round(sums[i] / counts[i], 6) if counts[i] else 0.0,
            }
        )

    return {
        "backend": "roughness",
        "version": VERSION,
        "model": MODEL,
        "binSeconds": bin_seconds,
        "sampleRate": rate,
        "durationSeconds": round(duration, 4),
        "mean": round(float(np.mean(R)), 6),
        "p95": round(float(np.percentile(R, 95)), 6),
        "bins": bins,
    }


def doctor():
    """Probe dependency availability WITHOUT importing heavy deps (find_spec only)."""
    missing = [m for m in DEPS if importlib.util.find_spec(m) is None]
    has_sf = importlib.util.find_spec("soundfile") is not None
    return {
        "backend": "roughness",
        "version": VERSION,
        "model": MODEL,
        "available": not missing,
        "soundfile": has_sf,
        **({"missing": missing, "fix": f"pip install -r {REQUIREMENTS}"} if missing else {}),
    }


def main(argv):
    p = argparse.ArgumentParser(prog="roughness.py", description="dotbeat time-varying roughness sidecar")
    p.add_argument("--input")
    p.add_argument("--bin-seconds", type=float, default=DEFAULT_BIN_SECONDS)
    p.add_argument("--doctor", action="store_true")
    args = p.parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0
    if not args.input:
        raise UsageError("missing --input <audio.wav> (or pass --doctor)")
    if not (args.bin_seconds > 0):
        raise UsageError("--bin-seconds must be positive")

    result = run(args.input, args.bin_seconds)
    print(json.dumps(result))
    sys.stdout.flush()
    sys.stderr.flush()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UsageError as e:
        print(f"usage error: {e}", file=sys.stderr)
        sys.exit(2)
    except DependencyError as e:
        print(f"dependency error: {e}", file=sys.stderr)
        print(f"pip install -r {REQUIREMENTS}", file=sys.stderr)
        sys.exit(3)
    except RoughnessError as e:
        print(f"roughness error: {e}", file=sys.stderr)
        sys.exit(4)

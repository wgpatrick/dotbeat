#!/usr/bin/env python3
"""dotbeat stem-isolation sidecar — GUARANTEED single-instrument clips from a full-mix generation.

Why this exists: Lyria (and every other long-form music model on the fal bake-off) is a FULL-TRACK
model. Google's own prompt guide says genre/era leads; three escalating prompt-side attempts at
isolation — prose "solo bassline only", the real `negative_prompt` channel, instrument-first
framing — all still came back as a band recording (owner rating passes, 2026-07-25). Prompting is
not a guarantee. EXTRACTION is: run the generated mix through Demucs and keep one stem.

A sibling on the analyze.py / gen.py / roughness.py / surge_render.py template. Like gen.py (and
unlike analyze.py) it WRITES A FILE — the extracted stem lands at `--output` and only a small JSON
metadata doc goes to stdout.

CONTRACT:
  argv:   --input <audio> --stem <bass|other|drums|vocals> --output <stem.wav>
          [--model htdemucs] [--device auto|cpu|mps|cuda] [--silence-margin-db 25]
          --doctor                                             (dependency probe, no heavy import)
  stdout: {"backend","version","model","device","stem","stemUsed","fallback","outPath",
           "sampleRate","durationSeconds","mixRmsDb","keptRmsDb","residualRmsDb","stemsRmsDb"}
  exit:   0 ok · 2 usage/bad input · 3 missing dependency · 4 extraction failure.
          On exit 3 the LAST stderr line is a copy-pasteable `pip install -r ...` fix.

Determinism: `apply_model(..., shifts=0)` — the only stochastic knob Demucs has is `shifts`, which
time-shifts the input by a RANDOM offset and averages; with shifts=0 the separation is a pure
function of the input bytes, the model bag, and the device. Same file + same device -> same stem.
(cpu and mps do NOT agree bit-for-bit, which is why `--device` is recorded in the output.)

THE NEAR-SILENCE GUARD (never emit silence): sometimes the prompt DID produce a near-solo instrument
and Demucs files it under a stem we didn't ask for — a solo synth bass often lands in `other`, a
pad-like bass in `other` too. Asking for `bass` then yields a near-empty file, which would poison a
blind eval far worse than a slightly contaminated one. So when the requested stem sits more than
`--silence-margin-db` below the mix, fall back — `other` first, then the loudest non-drums stem,
then the loudest stem overall — and RECORD which was used and why (`stemUsed` + `fallback`).

Top-level imports are stdlib ONLY (the house convention); torch/demucs/numpy are lazy.
"""

import argparse
import importlib.util
import json
import math
import os
import struct
import sys
import wave

REQUIREMENTS = "python/requirements-demucs.txt"
VERSION = "1.0.0"
DEFAULT_MODEL = "htdemucs"
DEFAULT_SILENCE_MARGIN_DB = 25.0
STEMS = ("drums", "bass", "other", "vocals")
DEPS = ("demucs", "torch", "numpy")
SILENCE_FLOOR_DB = -120.0


class UsageError(Exception):
    """Bad/unsupported argv or parameters — exit 2."""


class DependencyError(Exception):
    """The sidecar's Python deps aren't installed — exit 3."""


class ExtractError(Exception):
    """Demucs ran (or tried to) but produced no usable stem — exit 4."""


def _hf_cache_dir():
    """Where huggingface_hub keeps model repos (demucs 4.x fetches its bags from the HF hub)."""
    hub = os.environ.get("HF_HUB_CACHE")
    if hub:
        return hub
    home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    return os.path.join(home, "hub")


def _weights_cached(model_name):
    """True when this model bag is already in the HF cache (so the run needs no network)."""
    if model_name == "htdemucs":
        repo = "HTDemucs"
    elif model_name.startswith("htdemucs_"):
        repo = "HTDemucs-" + model_name[len("htdemucs_"):]
    else:
        repo = "Demucs-" + model_name
    return os.path.isdir(os.path.join(_hf_cache_dir(), f"models--adefossez--{repo}"))


def _prefer_offline(model_name):
    """Pin huggingface_hub OFFLINE when the weights are already cached and the caller didn't say
    otherwise. Without this, every extraction opens an etag request to huggingface.co; on a flaky
    or proxied network that turns into a silent multi-minute SSL retry loop (0% CPU, no output) in
    the middle of a batch. Cached weights need no network at all, so don't ask for one. MUST run
    before huggingface_hub is imported — it reads the flag at import time."""
    if "HF_HUB_OFFLINE" in os.environ:
        return False
    if _weights_cached(model_name):
        os.environ["HF_HUB_OFFLINE"] = "1"
        return True
    return False


def _rms_db(x):
    """RMS of a numpy array in dBFS, floored so silence is a number rather than -inf."""
    import numpy as np  # noqa: PLC0415

    r = float(np.sqrt(np.mean(np.square(np.asarray(x, dtype="float64"))))) if x.size else 0.0
    return SILENCE_FLOOR_DB if r <= 1e-6 else round(20.0 * math.log10(r), 3)


def _read_wav_stdlib(path):
    """Decode a 16-bit PCM WAV to (samples[frames, channels] float, rate) with no third-party dep."""
    import numpy as np  # noqa: PLC0415

    try:
        with wave.open(path, "rb") as w:
            channels, width, rate, nframes = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            frames = w.readframes(nframes)
    except (wave.Error, OSError) as e:
        raise ExtractError(f"could not read WAV {path}: {e}")
    if width != 2:
        raise ExtractError(f"{path}: the stdlib decoder needs 16-bit PCM (got {8 * width}-bit) — install soundfile")
    count = len(frames) // 2
    data = np.asarray(struct.unpack(f"<{count}h", frames[: count * 2]), dtype="float32") / 32768.0
    return data.reshape(-1, channels), rate


def _load_audio(path):
    """(float32 tensor [channels, samples], sample_rate). soundfile handles every container the gen
    path can hand us (wav/flac/ogg/mp3); the stdlib wave fallback keeps 16-bit PCM working without it."""
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415

    if importlib.util.find_spec("soundfile") is not None:
        import soundfile as sf  # noqa: PLC0415

        try:
            data, rate = sf.read(path, always_2d=True, dtype="float32")
        except Exception as e:
            raise ExtractError(f"could not read audio {path}: {e}")
    else:
        data, rate = _read_wav_stdlib(path)
    arr = np.ascontiguousarray(np.asarray(data, dtype="float32").T)  # [channels, samples]
    if arr.size == 0:
        raise ExtractError(f"{path}: no audio frames")
    return torch.from_numpy(arr), int(rate)


def _write_wav16(path, wav, rate):
    """Write a [channels, samples] float tensor as 16-bit PCM — the one container every dotbeat
    decoder reads, and what prep normalizes from anyway."""
    import numpy as np  # noqa: PLC0415

    arr = np.asarray(wav, dtype="float32").T  # [samples, channels]
    ints = np.clip(np.round(arr * 32767.0), -32768, 32767).astype("<i2")
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(arr.shape[1])
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(ints.tobytes())


def _pick_device(requested):
    import torch  # noqa: PLC0415

    if requested and requested != "auto":
        return requested
    # CPU by default, deliberately: a 30 s clip separates in well under a minute on an M-series CPU,
    # and cpu is the one device whose numerics are stable across torch builds here. `--device mps`
    # is available when a batch is big enough to care.
    return "cpu"


def _choose_stem(requested, stems_db, mix_db, margin_db):
    """The near-silence guard. Returns (stem_used, fallback_reason_or_None).

    Order: the requested stem -> `other` (where a solo synth/keys line usually lands) -> the loudest
    non-drums stem -> the loudest stem overall. Never returns a stem we know to be empty when a
    louder one exists, which is the whole "never emit silence" promise."""
    floor = mix_db - margin_db
    if stems_db[requested] >= floor:
        return requested, None
    reason = f"{requested} is {round(mix_db - stems_db[requested], 1)} dB below the mix (> {margin_db} dB)"
    chain = ["other"]
    non_drums = sorted((s for s in STEMS if s != "drums"), key=lambda s: stems_db[s], reverse=True)
    chain += non_drums
    chain += sorted(STEMS, key=lambda s: stems_db[s], reverse=True)
    for cand in chain:
        if cand != requested and stems_db[cand] >= floor:
            return cand, f"{reason}; fell back to {cand}"
    loudest = max(STEMS, key=lambda s: stems_db[s])
    return loudest, f"{reason}; no stem cleared the floor — kept the loudest ({loudest})"


def run(input_path, stem, output_path, model_name, device_arg, margin_db):
    missing = [m for m in DEPS if importlib.util.find_spec(m) is None]
    if missing:
        raise DependencyError(f"missing Python package(s) {', '.join(missing)} for the stem-extract sidecar")
    if not os.path.exists(input_path):
        raise UsageError(f"no audio file at {input_path}")

    offline = _prefer_offline(model_name)  # BEFORE huggingface_hub is imported (via demucs)

    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415

    try:
        from demucs.apply import apply_model  # noqa: PLC0415
        from demucs.audio import convert_audio  # noqa: PLC0415
        from demucs.pretrained import get_model  # noqa: PLC0415
    except Exception as e:  # a broken/partial install reads as a dependency problem, not a crash
        raise DependencyError(f"demucs is installed but unimportable: {e}")

    try:
        model = get_model(model_name)
    except Exception as e:
        hint = " (weights are not in the HF cache and HF_HUB_OFFLINE is set)" if offline else ""
        raise ExtractError(f"could not load demucs model '{model_name}': {e}{hint}")
    model.eval()
    sources = list(getattr(model, "sources", STEMS))
    if stem not in sources:
        raise UsageError(f"--stem {stem} is not produced by {model_name} (has: {', '.join(sources)})")

    wav, rate = _load_audio(input_path)
    duration = wav.shape[1] / rate
    mix = convert_audio(wav, rate, model.samplerate, model.audio_channels)
    # Demucs was trained on loudness-ish-normalized material; separate on the normalized signal and
    # scale back afterwards so the stem sits at the mix's own level (levels feed the guard).
    ref_mean, ref_std = mix.mean(), mix.std()
    normalized = (mix - ref_mean) / (ref_std if float(ref_std) > 1e-8 else 1.0)

    device = _pick_device(device_arg)
    try:
        with torch.no_grad():
            # shifts=0 => deterministic (shifts>0 averages RANDOM time-shifts). overlap/split are
            # the library defaults; both are deterministic.
            out = apply_model(model, normalized[None], shifts=0, split=True, overlap=0.25, progress=False, device=device)[0]
    except Exception as e:
        raise ExtractError(f"demucs separation failed on {device}: {e}")
    out = out * (ref_std if float(ref_std) > 1e-8 else 1.0) + ref_mean

    mix_np = mix.cpu().numpy()
    stems_np = {name: out[i].cpu().numpy() for i, name in enumerate(sources)}
    stems_db = {name: _rms_db(arr) for name, arr in stems_np.items()}
    mix_db = _rms_db(mix_np)

    used, fallback = _choose_stem(stem, stems_db, mix_db, margin_db)
    kept = stems_np[used]
    residual = mix_np - kept  # everything we threw away — the contamination that used to ship

    _write_wav16(output_path, kept, model.samplerate)

    return {
        "backend": "stem-extract",
        "version": VERSION,
        "model": model_name,
        "device": device,
        "offline": offline,
        "stem": stem,
        "stemUsed": used,
        "fallback": fallback,
        "outPath": os.path.abspath(output_path),
        "sampleRate": int(model.samplerate),
        "durationSeconds": round(duration, 4),
        "mixRmsDb": mix_db,
        "keptRmsDb": stems_db[used],
        "residualRmsDb": _rms_db(residual),
        "stemsRmsDb": {name: stems_db[name] for name in sources},
        "silenceMarginDb": margin_db,
    }


def doctor(model_name=DEFAULT_MODEL):
    """Probe availability WITHOUT importing torch/demucs (find_spec only) — same as the siblings."""
    missing = [m for m in DEPS if importlib.util.find_spec(m) is None]
    return {
        "backend": "stem-extract",
        "version": VERSION,
        "model": model_name,
        "available": not missing,
        "soundfile": importlib.util.find_spec("soundfile") is not None,
        "weightsCached": _weights_cached(model_name),
        "stems": list(STEMS),
        **({"missing": missing, "fix": f"pip install -r {REQUIREMENTS}"} if missing else {}),
    }


def main(argv):
    p = argparse.ArgumentParser(prog="stem_extract.py", description="dotbeat Demucs stem-isolation sidecar")
    p.add_argument("--input")
    p.add_argument("--stem", choices=list(STEMS))
    p.add_argument("--output")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--device", default="auto")
    p.add_argument("--silence-margin-db", type=float, default=DEFAULT_SILENCE_MARGIN_DB)
    p.add_argument("--doctor", action="store_true")
    args = p.parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor(args.model)))
        return 0
    if not args.input:
        raise UsageError("missing --input <audio> (or pass --doctor)")
    if not args.stem:
        raise UsageError(f"missing --stem <{'|'.join(STEMS)}>")
    if not args.output:
        raise UsageError("missing --output <stem.wav>")
    if not (args.silence_margin_db > 0):
        raise UsageError("--silence-margin-db must be positive")

    result = run(args.input, args.stem, args.output, args.model, args.device, args.silence_margin_db)
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
    except ExtractError as e:
        print(f"stem extract error: {e}", file=sys.stderr)
        sys.exit(4)

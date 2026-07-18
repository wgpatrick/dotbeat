#!/usr/bin/env python3
"""dotbeat audio-embedding sidecar (taste-loop T2, docs/taste-loop-design.md L1).

Third sibling on the analyze.py/gen.py template: turn ONE audio file into ONE embedding vector —
the learned feature space the taste model concatenates with the DSP metrics
(docs/research/107-taste-model-program.md Part 4 picked the backbone: LAION-CLAP
`laion/larger_clap_music`, Apache-2.0 weights, 512-d per clip). Pure function of its inputs, knows
nothing about dotbeat.

CONTRACT:
  argv:  --backend <stub|clap> --input <audio.wav> [--model <hf-id>]
         --doctor                                             (dependency probe)
  stdout: {"backend","model","dims","sampleRate","embedding":[...]}   -- one JSON line.
  exit:  0 ok · 2 usage/bad input · 3 missing dependency · 4 embedding failure.
         On exit 3 the LAST stderr line is a copy-pasteable `pip install -r ...` fix.

Backends:
  clap  LAION-CLAP via transformers (lazy import; deps in python/requirements-clap.txt, owner-side
        — first run downloads ~2GB of weights from Hugging Face into the usual HF cache).
  mert  MERT-v1-330M via transformers (deps in python/requirements-mert.txt) — stronger on music
        benchmarks, 1024-d mean-pooled frame features, but CC-BY-NC WEIGHTS: personal use only.
  stub  pure-stdlib deterministic 16-dim embedding (RMS/zero-crossing/band-energy-ish stats over
        fixed windows) — NOT perceptually meaningful; exists so the whole pipeline (spawn, cache,
        PCA, taste-eval ablation) runs and tests everywhere, same stance as gen.py's stub.

Top-level imports are stdlib ONLY (analyze.py/gen.py convention).
"""

import argparse
import importlib.util
import json
import math
import struct
import sys
import wave

BACKEND_REQUIREMENTS = {
    "clap": "python/requirements-clap.txt",
    "mert": "python/requirements-mert.txt",
    "aes": "python/requirements-aesthetics.txt",
}
STUB_VERSION = "0.1.0"
STUB_DIMS = 16
DEFAULT_CLAP_MODEL = "laion/larger_clap_music"
# The bigger opt-in (research/107 Part 4): MERT-330M beats CLAP on music-understanding benchmarks
# but its WEIGHTS are CC-BY-NC-4.0 — fine for a personal taste model (the model only listens; it
# never touches the license of the audio it analyzes), not shippable in a commercial product.
DEFAULT_MERT_MODEL = "m-a-p/MERT-v1-330M"
# Audiobox-Aesthetics (research/107 §4.1, the T2 "explicit features" pick): the only model in the
# survey trained DIRECTLY on human aesthetic ratings (~97k crowd-annotated clips) — four named,
# interpretable axes rather than an embedding. Weights CC-BY-4.0 (license-clean).
DEFAULT_AES_MODEL = "facebook/audiobox-aesthetics"
AES_AXES = ["CE", "CU", "PC", "PQ"]  # content enjoyment/usefulness, production complexity/quality


class UsageError(Exception):
    """Bad/unsupported argv or parameters — exit 2."""


class DependencyError(Exception):
    """A backend's Python deps aren't installed — exit 3."""

    def __init__(self, message, requirements):
        super().__init__(message)
        self.requirements = requirements


class EmbeddingError(Exception):
    """The backend ran but failed to produce a usable result — exit 4."""


def read_wav_mono(path):
    """Decode a 16-bit PCM WAV to a mono float list + sample rate (stdlib only, stub's decoder)."""
    try:
        with wave.open(path, "rb") as w:
            channels = w.getnchannels()
            width = w.getsampwidth()
            rate = w.getframerate()
            frames = w.readframes(w.getnframes())
    except (wave.Error, OSError) as e:
        raise EmbeddingError(f"could not read WAV {path}: {e}")
    if width != 2:
        raise EmbeddingError(f"{path}: stub embedder needs 16-bit PCM, got {8 * width}-bit")
    count = len(frames) // 2
    samples = struct.unpack(f"<{count}h", frames[: count * 2])
    if channels > 1:
        mono = [sum(samples[i : i + channels]) / channels / 32768.0 for i in range(0, count - channels + 1, channels)]
    else:
        mono = [s / 32768.0 for s in samples]
    if not mono:
        raise EmbeddingError(f"{path}: no audio frames")
    return mono, rate


def run_stub(input_path):
    """Deterministic 16-dim vector: 8 windowed RMS values + 8 windowed zero-crossing rates.
    Deliberately simple and fully reproducible — plumbing truth, not perceptual truth."""
    mono, rate = read_wav_mono(input_path)
    n = len(mono)
    windows = 8
    step = max(1, n // windows)
    rms, zcr = [], []
    for w in range(windows):
        chunk = mono[w * step : (w + 1) * step] or [0.0]
        rms.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)))
        crossings = sum(1 for i in range(1, len(chunk)) if (chunk[i - 1] < 0) != (chunk[i] < 0))
        zcr.append(crossings / len(chunk))
    return {
        "backend": "stub",
        "model": f"stub-{STUB_VERSION}",
        "dims": STUB_DIMS,
        "sampleRate": rate,
        "embedding": [round(v, 8) for v in rms + zcr],
    }


def run_clap(input_path, model_id):
    """LAION-CLAP audio embedding via transformers — lazy imports, exit 3 with the fix if absent."""
    for mod in ("torch", "transformers", "librosa"):
        if importlib.util.find_spec(mod) is None:
            raise DependencyError(
                f"missing Python package '{mod}' for the clap backend",
                BACKEND_REQUIREMENTS["clap"],
            )
    import contextlib  # noqa: PLC0415

    import librosa  # noqa: PLC0415
    import torch  # noqa: PLC0415
    # transformers 5.x prints a "Loading weights" progress bar that can land on STDOUT — the
    # JSON-only channel (confirmed owner-side 2026-07-18: taste-eval's clap backend died parsing
    # it). Import + load + infer under redirect, same contract fix as gen.py's _StdoutToStderr.
    with contextlib.redirect_stdout(sys.stderr):
        from transformers import ClapModel, ClapProcessor  # noqa: PLC0415

    try:
        audio, _rate = librosa.load(input_path, sr=48000, mono=True)
    except Exception as e:  # librosa raises many types; the message is the useful part
        raise EmbeddingError(f"could not load {input_path}: {e}")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            model = ClapModel.from_pretrained(model_id)
            processor = ClapProcessor.from_pretrained(model_id)
        # transformers 5.x removed the deprecated `audios=` kwarg (hard ValueError); 4.38-era only
        # knows `audios=`. Try the current name first, fall back for older pins (confirmed
        # owner-side 2026-07-17 on transformers 5.13: `audios=` raises).
        try:
            inputs = processor(audio=audio, sampling_rate=48000, return_tensors="pt")
        except (ValueError, TypeError):
            inputs = processor(audios=audio, sampling_rate=48000, return_tensors="pt")
        with torch.no_grad():
            features = model.get_audio_features(**inputs)
        # Shape normalization, confirmed owner-side 2026-07-17/18: transformers 5.x returns an
        # extra leading dim, and for some clip lengths CLAP feature-fusion yields MULTIPLE 1024-d
        # windows (observed flat 65536 = 64x1024) — raw flattening cached wildly inconsistent dims
        # that silently corrupted centroid math. Mean-pool windows to ONE fixed 1024-d clip vector.
        # KNOWN OPEN ISSUE (2026-07-18, owner-side): for SOME clip lengths this path yields
        # 65536 = 64x1024 fused-window features instead of one 1024-d clip vector (observed on
        # ~0.2-4s one-shots; other clips give 1024). Downstream centroid math REQUIRES fixed dims —
        # taste-eval/t3 must treat non-1024 vectors as invalid until the CLAP fusion pooling is
        # properly implemented (naive .reshape/.mean attempts returned a ModelOutput field of the
        # wrong shape; needs a focused session against the transformers 5.x CLAP API).
        vector = features[0].reshape(-1).tolist()
    except Exception as e:
        raise EmbeddingError(f"CLAP embedding failed: {e}")
    return {
        "backend": "clap",
        "model": model_id,
        "dims": len(vector),
        "sampleRate": 48000,
        "embedding": vector,
    }


def run_mert(input_path, model_id):
    """MERT frame features, mean-pooled to one clip vector — lazy imports, exit 3 with the fix."""
    for mod in ("torch", "transformers", "librosa", "nnAudio"):
        if importlib.util.find_spec(mod) is None:
            raise DependencyError(
                f"missing Python package '{mod}' for the mert backend",
                BACKEND_REQUIREMENTS["mert"],
            )
    import librosa  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from transformers import AutoModel, Wav2Vec2FeatureExtractor  # noqa: PLC0415

    try:
        audio, _rate = librosa.load(input_path, sr=24000, mono=True)
    except Exception as e:
        raise EmbeddingError(f"could not load {input_path}: {e}")
    try:
        model = AutoModel.from_pretrained(model_id, trust_remote_code=True)
        extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_id, trust_remote_code=True)
        inputs = extractor(audio, sampling_rate=24000, return_tensors="pt")
        with torch.no_grad():
            hidden = model(**inputs).last_hidden_state  # [1, frames, dims]
        vector = hidden.mean(dim=1)[0].tolist()
    except Exception as e:
        raise EmbeddingError(f"MERT embedding failed: {e}")
    return {
        "backend": "mert",
        "model": model_id,
        "dims": len(vector),
        "sampleRate": 24000,
        "embedding": vector,
    }


def run_aes(input_path, model_id):
    """Audiobox-Aesthetics: four crowd-trained axes per clip — lazy imports, exit 3 with the fix.
    The four numbers come back as a 4-dim "embedding" ordered as AES_AXES so the caller's cache/
    transport plumbing is shared with the real embedding backends; the `axes` field names them."""
    for mod in ("torch", "audiobox_aesthetics"):
        if importlib.util.find_spec(mod) is None:
            raise DependencyError(
                f"missing Python package '{mod}' for the aes backend",
                BACKEND_REQUIREMENTS["aes"],
            )
    from audiobox_aesthetics.infer import initialize_predictor  # noqa: PLC0415

    try:
        predictor = initialize_predictor()
        scores = predictor.forward([{"path": input_path}])[0]
    except Exception as e:
        raise EmbeddingError(f"audiobox-aesthetics inference failed: {e}")
    missing = [a for a in AES_AXES if a not in scores]
    if missing:
        raise EmbeddingError(f"audiobox-aesthetics returned no {missing} axis (got keys: {sorted(scores)})")
    return {
        "backend": "aes",
        "model": model_id,
        "dims": len(AES_AXES),
        "sampleRate": 16000,  # the predictor resamples internally; informational only
        "axes": AES_AXES,
        "embedding": [float(scores[a]) for a in AES_AXES],
    }


def run_aes_stub(input_path):
    """Deterministic 4-dim stand-in for the aes axes, derived from simple audio stats — the same
    plumbing-truth-not-perceptual-truth stance as run_stub, shaped like run_aes so the taste-eval
    aes path (cache, z-scoring, BT scorer, report) runs and tests everywhere without torch."""
    mono, rate = read_wav_mono(input_path)
    n = len(mono)
    rms = math.sqrt(sum(x * x for x in mono) / n)
    peak = max(abs(x) for x in mono) or 1e-9
    crossings = sum(1 for i in range(1, n) if (mono[i - 1] < 0) != (mono[i] < 0))
    zcr = crossings / n
    half = n // 2 or 1
    rms_a = math.sqrt(sum(x * x for x in mono[:half]) / half)
    rms_b = math.sqrt(sum(x * x for x in mono[half:]) / max(1, n - half))
    return {
        "backend": "aes-stub",
        "model": f"aes-stub-{STUB_VERSION}",
        "dims": len(AES_AXES),
        "sampleRate": rate,
        "axes": AES_AXES,
        "embedding": [
            round(rms, 8),  # "CE": tracks overall level
            round(zcr, 8),  # "CU": tracks brightness-ish
            round(abs(rms_a - rms_b) / (rms or 1e-9), 8),  # "PC": tracks level movement
            round(rms / peak, 8),  # "PQ": tracks density (inverse crest)
        ],
    }


def doctor():
    """Probe backend availability WITHOUT importing heavy deps (find_spec only)."""
    clap_missing = [m for m in ("torch", "transformers", "librosa") if importlib.util.find_spec(m) is None]
    mert_missing = [m for m in ("torch", "transformers", "librosa", "nnAudio") if importlib.util.find_spec(m) is None]
    aes_missing = [m for m in ("torch", "audiobox_aesthetics") if importlib.util.find_spec(m) is None]
    return {
        "backends": {
            "stub": {"available": True, "version": STUB_VERSION, "dims": STUB_DIMS},
            "aes-stub": {"available": True, "version": STUB_VERSION, "axes": AES_AXES},
            "aes": {
                "available": not aes_missing,
                "model": DEFAULT_AES_MODEL,
                "axes": AES_AXES,
                "license_note": "CC-BY-4.0 weights (research/107 Part 4)",
                **({"missing": aes_missing, "fix": f"pip install -r {BACKEND_REQUIREMENTS['aes']}"} if aes_missing else {}),
            },
            "clap": {
                "available": not clap_missing,
                "model": DEFAULT_CLAP_MODEL,
                **({"missing": clap_missing, "fix": f"pip install -r {BACKEND_REQUIREMENTS['clap']}"} if clap_missing else {}),
            },
            "mert": {
                "available": not mert_missing,
                "model": DEFAULT_MERT_MODEL,
                "license_note": "CC-BY-NC weights: personal use only",
                **({"missing": mert_missing, "fix": f"pip install -r {BACKEND_REQUIREMENTS['mert']}"} if mert_missing else {}),
            },
        }
    }


def main(argv):
    p = argparse.ArgumentParser(prog="embed.py", description="dotbeat audio-embedding sidecar")
    p.add_argument("--backend", choices=["stub", "clap", "mert", "aes", "aes-stub"])
    p.add_argument("--input")
    p.add_argument("--model", default=None)
    p.add_argument("--doctor", action="store_true")
    args = p.parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0
    if not args.backend or not args.input:
        raise UsageError("missing --backend (one of: stub, clap, mert, aes, aes-stub) or --input, or pass --doctor")

    if args.backend == "stub":
        result = run_stub(args.input)
    elif args.backend == "aes":
        result = run_aes(args.input, args.model or DEFAULT_AES_MODEL)
    elif args.backend == "aes-stub":
        result = run_aes_stub(args.input)
    elif args.backend == "mert":
        result = run_mert(args.input, args.model or DEFAULT_MERT_MODEL)
    else:
        result = run_clap(args.input, args.model or DEFAULT_CLAP_MODEL)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UsageError as e:
        print(f"usage error: {e}", file=sys.stderr)
        sys.exit(2)
    except DependencyError as e:
        print(f"dependency error: {e}", file=sys.stderr)
        print(f"pip install -r {e.requirements}", file=sys.stderr)
        sys.exit(3)
    except EmbeddingError as e:
        print(f"embedding error: {e}", file=sys.stderr)
        sys.exit(4)

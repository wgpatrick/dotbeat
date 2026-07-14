#!/usr/bin/env python3
"""dotbeat generative-audio sidecar (Phase 39 Stream UB, docs/phase-39-plan.md).

The SECOND non-Node dependency, built on the exact same spawn/JSON/doctor/venv template as
analyze.py — with ONE deliberate variation of the contract. `analyze.py` emits its whole result as
stdout JSON; `gen.py` produces BINARY audio, so it **writes the generated WAV to the `--output`
path it is told to use** and prints a small JSON *metadata* document on stdout
(`{backend, provider, model, seconds, seed, sampleRate}`). All progress/model chatter goes to
stderr. The TypeScript side (src/analysis/gen.ts) and scripts/source-lib.mjs own registration,
provenance, and rollback — this file knows nothing about dotbeat's media block.

CONTRACT (docs/phase-39-plan.md §UB):
  argv:  --backend <stub|stableaudio> --prompt "<text>" --seconds <N> --seed <N> --output <wav>
         --doctor                                                       (dependency probe)
  stdout: {"backend","provider","model","seconds","seed","sampleRate"}  -- one JSON line, metadata.
  side effect: the generated 44.1 kHz stereo 16-bit PCM WAV is written to --output.
  exit:  0 ok · 2 usage/bad input · 3 missing dependency · 4 generation failure.
         On exit 3 the LAST stderr line is a copy-pasteable `pip install -r ...` fix.

Top-level imports are stdlib ONLY. Backend deps (stable_audio_tools, torch) are imported LAZILY
inside run_stableaudio() so `--backend stub` and `--doctor` work with zero packages installed (the
reality of this container and CI). Copied verbatim from analyze.py's conventions — kept boring.
"""

import argparse
import importlib.util
import json
import math
import random
import struct
import sys
import wave

# Backends whose deps live in a requirements-<name>.txt (for the exit-3 fix line + --doctor probe).
BACKEND_REQUIREMENTS = {
    "stableaudio": "python/requirements-stableaudio.txt",
}
# The stub is pure-stdlib and always available; version is a fixed string so tests can assert it.
STUB_VERSION = "0.1.0"

SAMPLE_RATE = 44100  # 44.1 kHz stereo throughout — matches dotbeat's render + prep-oneshot format.
STABLEAUDIO_MAX_SECONDS = 47  # Stable Audio Open 1.0 tops out around 47 s (research 103).


class UsageError(Exception):
    """Bad/unsupported argv or parameters — exit 2."""


class DependencyError(Exception):
    """A backend's Python deps aren't installed — exit 3. `requirements` names the fix file."""

    def __init__(self, message, requirements):
        super().__init__(message)
        self.requirements = requirements


class GenerationError(Exception):
    """The backend ran but failed to produce a usable result — exit 4."""


def log(*parts):
    """Progress/chatter — stderr ONLY (stdout is reserved for the one JSON metadata document)."""
    print(*parts, file=sys.stderr, flush=True)


def write_stereo_wav(output_path, samples_l, samples_r):
    """Write two float channels (each in [-1, 1]) as a 44.1 kHz stereo 16-bit PCM WAV via stdlib
    `wave`. Interleaves L/R and clamps before quantizing to int16 — the same 16-bit format the rest
    of dotbeat (render, prep-oneshot) speaks, so the output is decodable by our own pipeline."""
    n = len(samples_l)
    frames = bytearray()
    for i in range(n):
        for v in (samples_l[i], samples_r[i]):
            clamped = -1.0 if v < -1.0 else (1.0 if v > 1.0 else v)
            frames += struct.pack("<h", int(round(clamped * 32767)))
    with wave.open(output_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(frames))


# ---------------------------------------------------------------------------------------------
# stub backend — deterministic, stdlib-only. Exercises the ENTIRE pipeline (spawn, WAV write,
# metadata JSON, and the TS registration/provenance path) with no model, so `npm test` is green
# with zero Python packages. Given the same (seed, seconds) it emits a byte-identical WAV, so tests
# assert an exact sha256. It does NOT interpret the prompt — it just proves the plumbing.
# ---------------------------------------------------------------------------------------------


def run_stub(prompt, seconds, seed, output_path):
    if seconds <= 0:
        raise UsageError(f"--seconds must be positive, got {seconds}")
    n = int(round(seconds * SAMPLE_RATE))
    if n <= 0:
        raise UsageError(f"--seconds {seconds} yields zero samples")

    # Seed-derived tone + a touch of seeded noise. random.Random(seed) is stdlib and deterministic,
    # so the whole buffer is a pure function of (seed, seconds) — the test's hash-stability guarantee.
    rng = random.Random(seed)
    # Map the seed into a pleasant-ish audible frequency (110-770 Hz) so different seeds sound
    # different; the exact mapping doesn't matter, only that it's deterministic.
    freq = 110.0 + (seed % 12) * 55.0
    noise_amp = 0.05
    tone_amp = 0.35
    # A short linear fade in/out (5 ms) against edge clicks — mirrors prep-oneshot's fade intent.
    fade = min(int(0.005 * SAMPLE_RATE), n // 2)

    left = [0.0] * n
    right = [0.0] * n
    for i in range(n):
        t = i / SAMPLE_RATE
        tone = tone_amp * math.sin(2.0 * math.pi * freq * t)
        noise = noise_amp * (rng.random() * 2.0 - 1.0)
        env = 1.0
        if fade > 0:
            if i < fade:
                env = i / fade
            elif i >= n - fade:
                env = (n - 1 - i) / fade
        left[i] = (tone + noise) * env
        # right channel: same tone, independent noise draw -> a subtle stereo width, still deterministic
        right[i] = (tone + noise_amp * (rng.random() * 2.0 - 1.0)) * env

    write_stereo_wav(output_path, left, right)
    return {
        "backend": "stub",
        "provider": "stub",
        "model": f"stub-{STUB_VERSION}",
        "seconds": seconds,
        "seed": seed,
        "sampleRate": SAMPLE_RATE,
    }


# ---------------------------------------------------------------------------------------------
# stableaudio backend — Stable Audio Open 1.0 (Stability AI), run LOCALLY (research 103). Lazily
# imports stable-audio-tools + torch; generates from the prompt/seconds/seed and writes a 44.1 kHz
# stereo WAV. OWNER-SIDE / UNVERIFIED: torch + the ~couple-GB HF weights are absent (and egress is
# blocked) in this container, so this path cannot run or be tested here — it is written to be
# obviously correct and is validated owner-side per python/README.md. The exact HF weights repo id
# and the stable-audio-tools API surface are PLACEHOLDERS to confirm owner-side.
# ---------------------------------------------------------------------------------------------

# Placeholder HF weights repo id — MUST be confirmed owner-side (HF unreachable here).
STABLEAUDIO_MODEL_ID = "stabilityai/stable-audio-open-1.0"


def run_stableaudio(prompt, seconds, seed, output_path):
    if not prompt or not prompt.strip():
        raise UsageError("stableaudio backend needs a non-empty --prompt")
    if seconds <= 0:
        raise UsageError(f"--seconds must be positive, got {seconds}")
    if seconds > STABLEAUDIO_MAX_SECONDS:
        # The model tops out ~47 s; clamp rather than fail so a too-long request still produces audio.
        log(f"stableaudio: clamping --seconds {seconds} -> {STABLEAUDIO_MAX_SECONDS} (model cap)")
        seconds = STABLEAUDIO_MAX_SECONDS

    log("stableaudio: loading torch + stable-audio-tools (first run downloads the model weights)...")
    try:
        import torch
        from stable_audio_tools import get_pretrained_model
        from stable_audio_tools.inference.generation import generate_diffusion_cond
    except ImportError as e:
        raise DependencyError(
            f"Stable Audio Open backend unavailable ({e}).",
            BACKEND_REQUIREMENTS["stableaudio"],
        )

    # OWNER-SIDE / UNVERIFIED below this line: the stable-audio-tools call shapes are the documented
    # 1.0 API as of research 103 but were not runnable here — confirm against the installed version.
    try:
        device = "cuda" if _cuda_available() else "cpu"
        log(f"stableaudio: running on {device}")
        torch.manual_seed(seed)

        model, model_config = get_pretrained_model(STABLEAUDIO_MODEL_ID)
        sample_rate = model_config["sample_rate"]
        sample_size = int(seconds * sample_rate)
        model = model.to(device)

        conditioning = [{"prompt": prompt, "seconds_start": 0, "seconds_total": seconds}]
        output = generate_diffusion_cond(
            model,
            conditioning=conditioning,
            sample_size=sample_size,
            device=device,
            seed=seed,
        )

        # output: a torch tensor shaped [batch, channels, samples] in [-1, 1]. Take batch 0, force
        # stereo, resample to 44.1 kHz if the model's native rate differs, and hand two float lists
        # to the shared 16-bit writer.
        audio = output[0].to(torch.float32).cpu()
        left, right = _tensor_to_stereo_channels(audio, sample_rate, torch)
        write_stereo_wav(output_path, left, right)
    except DependencyError:
        raise
    except Exception as e:  # model/inference/IO failure is exit 4, distinct from a missing dep (3).
        raise GenerationError(f"Stable Audio Open generation failed: {e}")

    return {
        "backend": "stableaudio",
        "provider": "stable-audio-open",
        "model": STABLEAUDIO_MODEL_ID,
        "seconds": seconds,
        "seed": seed,
        "sampleRate": SAMPLE_RATE,
    }


def _cuda_available():
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _tensor_to_stereo_channels(audio, native_rate, torch):
    """OWNER-SIDE helper: coerce a [channels, samples] tensor to two 44.1 kHz float lists. Mono is
    duplicated to stereo; a non-44.1 kHz native rate is linearly resampled. Kept simple/unverified."""
    if audio.dim() == 1:
        audio = audio.unsqueeze(0)
    if audio.shape[0] == 1:
        audio = audio.repeat(2, 1)
    audio = audio[:2]
    if native_rate != SAMPLE_RATE:
        n_out = int(audio.shape[1] * SAMPLE_RATE / native_rate)
        idx = torch.linspace(0, audio.shape[1] - 1, n_out)
        lo = idx.floor().long().clamp(0, audio.shape[1] - 1)
        audio = audio[:, lo]
    left = audio[0].tolist()
    right = audio[1].tolist()
    return left, right


BACKENDS = {"stub": run_stub, "stableaudio": run_stableaudio}


# ---------------------------------------------------------------------------------------------
# --doctor — dependency probe. Uses importlib.util.find_spec, which locates a module WITHOUT
# importing/executing it (so probing torch never actually loads torch — safe and fast). stub is
# always ok. Prints JSON on stdout so the TS side can render a readable report.
# ---------------------------------------------------------------------------------------------

# Modules each backend needs, in the order they matter for the "missing" list.
_BACKEND_MODULES = {
    "stableaudio": ("torch", "stable_audio_tools"),
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
    p = argparse.ArgumentParser(prog="gen.py", description="dotbeat generative-audio sidecar")
    p.add_argument("--backend", choices=sorted(BACKENDS.keys()))
    p.add_argument("--prompt")
    p.add_argument("--seconds", type=float)
    p.add_argument("--seed", type=int)
    p.add_argument("--output")
    p.add_argument("--doctor", action="store_true")
    return p.parse_args(argv)


def main(argv):
    args = parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0

    if not args.backend:
        raise UsageError("missing --backend (one of: stub, stableaudio) or --doctor")
    if args.prompt is None:
        raise UsageError('missing --prompt "<text>"')
    if args.seconds is None:
        raise UsageError("missing --seconds <N>")
    if args.seed is None:
        raise UsageError("missing --seed <N>")
    if not args.output:
        raise UsageError("missing --output <wav path>")

    meta = BACKENDS[args.backend](args.prompt, args.seconds, args.seed, args.output)
    # stdout gets exactly one line: the metadata document. Nothing else may touch stdout.
    print(json.dumps(meta))
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
    except GenerationError as e:
        log(f"error: {e}")
        sys.exit(4)
    except KeyboardInterrupt:
        sys.exit(130)

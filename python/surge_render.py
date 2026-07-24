#!/usr/bin/env python3
"""dotbeat Surge XT render sidecar (source-showdown probe B1, docs/research/114-synth-engine-
alternatives.md §7 "Surge-as-sound-factory").

Renders a note sequence through a Surge XT factory patch via the `surgepy` Python bindings and
writes a WAV. Fourth sibling on the analyze.py / gen.py / embed.py template: a tiny, dumb, pure
function of its inputs that knows NOTHING about dotbeat — the TypeScript side (src/analysis/
surge.ts) owns spawning, patch selection, note conversion, and the showdown clip pipeline.

WHY A FACTORY-SHAPE SIDECAR (not a live engine): Surge XT is GPLv3, so it can never link into a
shippable dotbeat build, but rendering audio through it out-of-process is "mere aggregation" and
the OUTPUT carries no code copyleft (research 114 §2.1). The factory-PATCH *content* license is a
separate, still-open upstream question (surge issue #6741), so anything this renders stays
eval-private — the TS side gitignore-gates every batch that contains a surge clip, same posture as
the private ref chops.

CONTRACT (mirrors gen.py: stdlib-only top level, lazy surgepy import, JSON on stdout, chatter on
stderr, exit codes 0/2/3/4, `--doctor` probing deps with importlib only):

  --doctor            probe surgepy availability + Surge factory-content path + factory patch count
  --list-patches      emit the factory patch listing as JSON {patches:[{name,category,path}]}
  (default / render)  read one render request as JSON on STDIN, write a WAV, print metadata JSON

  render stdin JSON:  {"patch": "<abs .fxp path>",
                       "notes": [{"midi": 48, "startSeconds": 0.0,
                                  "durationSeconds": 0.5, "velocity": 100}, ...],
                       "overrides": [{"param": "cutoff", "value": 0.62}, ...],  # optional, 0..1
                       "sampleRate": 44100,
                       "output": "<abs .wav path>"}
  render stdout JSON: {"backend":"surge","patch","patchName","category","notes","overrides",
                       "sampleRate","seconds","output"}
  exit:  0 ok · 2 usage/bad input · 3 surgepy missing · 4 render/patch failure.
         On exit 3 the LAST stderr line names how to get surgepy (there is NO PyPI wheel — it is a
         source-build artifact of Surge XT itself; see the SURGEPY_BUILD_HINT below and
         python/README.md).

surgepy is NOT pip-installable (confirmed 2026-07-21: `pip install surgepy` -> "No matching
distribution found"). It ships only as a compiled module produced by building Surge XT from source
with its Python bindings enabled. The build path is documented in python/README.md; --doctor says
exactly what is missing so the probe is honest in a stub/CI environment.
"""

import argparse
import glob
import importlib.util
import json
import os
import sys

# The one-liner surfaced on exit 3 (and in --doctor when surgepy is absent). surgepy has no wheel;
# it is a CMake build target of the Surge XT repo. Kept blunt and copy-pasteable.
SURGEPY_BUILD_HINT = (
    "surgepy is not on PyPI (no wheel). Build it from Surge XT source: "
    "git clone --recurse-submodules https://github.com/surge-synthesizer/surge && "
    "cd surge && cmake -Bbuild -DSURGE_BUILD_PYTHON_BINDINGS=TRUE && "
    "cmake --build build --config Release --target surgepy, then put the built module on "
    "PYTHONPATH (or copy it into python/.venv). See python/README.md."
)


class UsageError(Exception):
    """Bad/unsupported argv or stdin — exit 2."""


class DependencyError(Exception):
    """surgepy isn't importable — exit 3."""


class RenderError(Exception):
    """surgepy loaded but the patch/render failed — exit 4."""


def _surgepy_available():
    """True iff `import surgepy` would succeed — importlib only, never executes the module."""
    return importlib.util.find_spec("surgepy") is not None


def _create_surge(sample_rate):
    """Instantiate a SurgeSynthesizer at `sample_rate`. Raises DependencyError (exit 3) when the
    module is absent, RenderError (exit 4) when it is present but won't construct."""
    if not _surgepy_available():
        raise DependencyError("missing Python module 'surgepy'")
    import surgepy  # noqa: PLC0415

    try:
        return surgepy.createSurge(int(sample_rate))
    except Exception as e:  # pragma: no cover - needs a real surgepy build
        raise RenderError(f"surgepy.createSurge({sample_rate}) failed: {e}")


def _factory_data_path(surge):
    """Best-effort Surge factory-content root. The exact accessor has drifted across surgepy
    builds, so try the known names in order and fall back to None rather than crashing."""
    for name in ("getFactoryDataPath", "getFactoryDataPathString", "factoryDataPath"):
        getter = getattr(surge, name, None)
        if getter is None:
            continue
        try:
            value = getter() if callable(getter) else getter
        except Exception:  # pragma: no cover - build-specific
            continue
        if value:
            return str(value)
    return None


def _patches_root(factory_path):
    """The dir that actually holds factory patches. Surge lays them out under
    <factory>/patches_factory/<Category>/<name>.fxp; be tolerant of a path already pointing at
    patches_factory."""
    if not factory_path:
        return None
    if os.path.basename(os.path.normpath(factory_path)) == "patches_factory":
        return factory_path
    candidate = os.path.join(factory_path, "patches_factory")
    if os.path.isdir(candidate):
        return candidate
    # some builds return the resources dir one level up
    alt = os.path.join(factory_path, "resources", "data", "patches_factory")
    return alt if os.path.isdir(alt) else (candidate if os.path.isdir(factory_path) else None)


def enumerate_patches(patches_root):
    """List every factory .fxp as {name, category, path}. `category` is the first directory
    component under patches_root (Surge's top-level patch category, e.g. Basses / Leads / Pads);
    a patch sitting directly in the root gets category "" . Sorted by (category, name) so the TS
    seeded pick is stable across machines with the same factory content."""
    if not patches_root or not os.path.isdir(patches_root):
        return []
    out = []
    for path in glob.glob(os.path.join(patches_root, "**", "*.fxp"), recursive=True):
        rel = os.path.relpath(path, patches_root)
        parts = rel.split(os.sep)
        category = parts[0] if len(parts) > 1 else ""
        name = os.path.splitext(os.path.basename(path))[0]
        out.append({"name": name, "category": category, "path": os.path.abspath(path)})
    out.sort(key=lambda p: (p["category"].lower(), p["name"].lower()))
    return out


def doctor():
    """Probe surgepy availability + factory path + patch count. When surgepy is absent this stays
    a pure importlib/filesystem probe (no import); when present it constructs a synth to read the
    real factory path, and degrades to available:true/patchCount:null if that construction fails."""
    available = _surgepy_available()
    report = {
        "backend": "surge",
        "surgepy": {"available": available},
        "factoryPath": None,
        "patchesRoot": None,
        "patchCount": None,
    }
    if not available:
        report["surgepy"]["missing"] = ["surgepy"]
        report["surgepy"]["fix"] = SURGEPY_BUILD_HINT
        return report
    try:
        surge = _create_surge(44100)
        factory = _factory_data_path(surge)
        root = _patches_root(factory)
        report["factoryPath"] = factory
        report["patchesRoot"] = root
        report["patchCount"] = len(enumerate_patches(root))
    except Exception as e:  # pragma: no cover - needs a real surgepy build
        report["surgepy"]["constructError"] = str(e)
    return report


def _ring_db(frames_lr, sample_rate):
    """Worst narrow high-frequency tonal peak across channels, in dB relative to the spectrum
    max — the "ringy noise" screen (owner, 2026-07-21: several factory patches carry a piercing
    4-8 kHz resonance, often hard-panned). A bin counts as a ring when it towers over its
    ±300 Hz neighborhood by >6x in the 4-14 kHz band. Returns ~-120 when nothing rings; the
    showdown CLI redraws the patch when this exceeds its threshold."""
    try:
        import numpy as np  # noqa: PLC0415
    except Exception:
        return None
    arr = np.asarray(frames_lr, dtype=np.float64)
    if arr.ndim != 2 or arr.shape[0] < 8192:
        return None
    worst = -120.0
    n_fft = 8192
    window = np.hanning(n_fft)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    hi = (freqs > 4000) & (freqs < 14000)
    for ch in range(arr.shape[1]):
        y = arr[:, ch]
        mags = [np.abs(np.fft.rfft(y[s:s + n_fft] * window)) for s in range(0, len(y) - n_fft, n_fft)]
        if not mags:
            continue
        spectrum = np.mean(mags, axis=0)
        smax = spectrum.max() + 1e-12
        shi = spectrum[hi]
        for i in range(len(shi)):
            neighborhood = np.median(shi[max(0, i - 56):min(len(shi), i + 56)]) + 1e-15
            if shi[i] > 6 * neighborhood:
                db = 20 * np.log10(shi[i] / smax)
                if db > worst:
                    worst = db
    return round(worst, 1)


# Friendly aliases (dotbeat Track 1a `override <param>` lines) -> the exact Surge parameter name
# `SurgeNamedParam.getName()` reports. Scene A is the default target (a single-scene patch). Keep
# this tiny and honest: an override name that isn't here still resolves by exact/substring match
# against the live patch's own param names, and an unresolved name is a loud render error.
_SURGE_OVERRIDE_ALIASES = {
    "cutoff": "a filter 1 cutoff",
    "resonance": "a filter 1 resonance",
    "filter1cutoff": "a filter 1 cutoff",
    "filter1resonance": "a filter 1 resonance",
    "filter2cutoff": "a filter 2 cutoff",
    "filter2resonance": "a filter 2 resonance",
    "volume": "global volume",
}


def _index_patch_params(surge):
    """Walk `surge.getPatch()` and return {lowercased param name -> param object} for every leaf
    parameter (a SurgeNamedParam, identified by its `getName` method). The structure is nested
    dicts and lists of these leaves; recurse over both."""
    index = {}

    def visit(node):
        if hasattr(node, "getName") and callable(getattr(node, "getName")):
            try:
                index[str(node.getName()).lower()] = node
            except Exception:  # pragma: no cover - build-specific
                pass
            return
        if isinstance(node, dict):
            for v in node.values():
                visit(v)
        elif isinstance(node, (list, tuple)):
            for v in node:
                visit(v)

    visit(surge.getPatch())
    return index


def _resolve_override_param(name, index):
    """Resolve a dotbeat override name to a Surge param object. Order: exact name match, then the
    friendly-alias table, then a UNIQUE substring match against the patch's own param names.
    Raises RenderError (exit 4) when nothing resolves or a substring match is ambiguous — the
    fail-loudly stance Track 1a requires at render time."""
    key = str(name).lower().strip()
    if key in index:
        return index[key]
    alias = _SURGE_OVERRIDE_ALIASES.get(key.replace(" ", ""))
    if alias and alias in index:
        return index[alias]
    matches = [k for k in index if key in k]
    if len(matches) == 1:
        return index[matches[0]]
    if len(matches) > 1:
        raise RenderError(
            f"override param '{name}' is ambiguous — matches {len(matches)} Surge params "
            f"(e.g. {', '.join(sorted(matches)[:4])}); use a more specific name"
        )
    raise RenderError(f"override param '{name}' did not resolve to any Surge parameter in this patch")


def _apply_overrides(surge, overrides):
    """Apply each {param, value} override to the loaded patch via setParamVal (value is normalized
    0..1, Surge's own param space). Returns the list of resolved Surge param names (for metadata).
    A bad param or out-of-range value is a loud render error, never a silent no-op."""
    if not overrides:
        return []
    index = _index_patch_params(surge)
    applied = []
    for ov in overrides:
        if not isinstance(ov, dict) or "param" not in ov or "value" not in ov:
            raise UsageError(f"each override needs 'param' and 'value', got {ov!r}")
        value = float(ov["value"])
        if not (0.0 <= value <= 1.0):
            raise UsageError(f"override value for '{ov['param']}' must be normalized 0..1, got {value}")
        param = _resolve_override_param(ov["param"], index)
        try:
            surge.setParamVal(param, value)
        except Exception as e:  # pragma: no cover - needs a real surgepy build
            raise RenderError(f"could not set override '{ov['param']}' = {value}: {e}")
        applied.append(param.getName())
    return applied


def _write_wav_pcm16(path, frames_lr, sample_rate):
    """Write interleaved stereo float frames (list/array of [L, R] in [-1, 1]) as 16-bit PCM WAV
    using stdlib `wave` — the encoding src/taste/showdown.ts's readWavData and the loudness/
    duration pipeline both accept. Clamps out-of-range samples."""
    import struct  # noqa: PLC0415
    import wave  # noqa: PLC0415

    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        buf = bytearray()
        for lr in frames_lr:
            for s in (lr[0], lr[1]):
                v = int(max(-1.0, min(1.0, float(s))) * 32767.0)
                buf += struct.pack("<h", v)
        w.writeframes(bytes(buf))


def render(request):
    """Load `request['patch']`, play `request['notes']` (each {midi, startSeconds, durationSeconds,
    velocity}), and write a stereo WAV to `request['output']`. Returns the metadata dict.

    Note events are quantized to Surge's block boundaries (block size is tiny, ~32 samples at
    44.1 kHz, so quantization is sub-millisecond) and a short tail is rendered after the last note
    off so releases/reverb decay aren't clipped."""
    patch = request.get("patch")
    notes = request.get("notes")
    overrides = request.get("overrides") or []
    sample_rate = int(request.get("sampleRate") or 44100)
    output = request.get("output")
    if not patch or not isinstance(patch, str):
        raise UsageError("render request needs a 'patch' path")
    if not output or not isinstance(output, str):
        raise UsageError("render request needs an 'output' wav path")
    if not isinstance(notes, list) or not notes:
        raise UsageError("render request needs a non-empty 'notes' list")
    if not isinstance(overrides, list):
        raise UsageError("render request 'overrides' must be a list of {param, value}")
    if not os.path.isfile(patch):
        raise RenderError(f"patch not found: {patch}")

    surge = _create_surge(sample_rate)
    try:
        surge.loadPatch(patch)
    except Exception as e:  # pragma: no cover - needs a real surgepy build
        raise RenderError(f"could not load patch {patch}: {e}")

    # Track 1a: normalized param overrides, applied after the patch loads and before any notes play.
    applied_overrides = _apply_overrides(surge, overrides)

    try:
        import numpy as np  # noqa: PLC0415
    except Exception as e:
        raise RenderError(f"numpy is required to collect surge output ({e})")

    block = int(surge.getBlockSize())
    tail_seconds = 1.5  # let releases/reverb ring out past the last note-off
    # Build (sampleIndex, kind, midi, velocity) events; kind 1 = note on, 0 = note off.
    events = []
    last_off = 0.0
    for n in notes:
        midi = int(n["midi"])
        start = float(n["startSeconds"])
        dur = float(n["durationSeconds"])
        vel = max(1, min(127, int(round(float(n["velocity"])))))
        on_s = int(round(start * sample_rate))
        off_s = int(round((start + dur) * sample_rate))
        events.append((on_s, 1, midi, vel))
        events.append((max(on_s + 1, off_s), 0, midi, vel))
        last_off = max(last_off, start + dur)
    events.sort(key=lambda e: (e[0], e[1]))  # at a tie, note-offs before note-ons

    total_samples = int(round((last_off + tail_seconds) * sample_rate))
    # Collection goes through processMultiBlock, NOT process()+getOutput(): getOutput() builds its
    # pybind11 array with interleaved strides instead of channel-major, so its "right channel" is
    # the LEFT channel delayed 2 samples with a splice at every block boundary — a comb filter
    # that read as a hard-panned-right 4-8 kHz ring in blind rating (root-caused 2026-07-22;
    # upstream surgepy bug, issue draft in the findings doc). processMultiBlock memcpys the true
    # stereo output. Events stay block-quantized exactly as before: dispatch everything due at
    # the block boundary, then render that one block into its slot of the shared buffer.
    n_blocks = (total_samples + block - 1) // block
    buf = surge.createMultiBlock(n_blocks)  # shape (2, n_blocks*block), float32
    ei = 0
    for b in range(n_blocks):
        pos = b * block
        while ei < len(events) and events[ei][0] <= pos:
            _, kind, midi, vel = events[ei]
            if kind == 1:
                surge.playNote(0, midi, vel, 0)
            else:
                surge.releaseNote(0, midi, 0)
            ei += 1
        surge.processMultiBlock(buf, b, 1)
    arr = np.asarray(buf)
    left = arr[0][:total_samples]
    right = (arr[1] if arr.shape[0] > 1 else arr[0])[:total_samples]
    frames = [(float(left[i]), float(right[i])) for i in range(total_samples)]
    _write_wav_pcm16(output, frames, sample_rate)
    return {
        "backend": "surge",
        "patch": os.path.abspath(patch),
        "patchName": os.path.splitext(os.path.basename(patch))[0],
        "category": os.path.basename(os.path.dirname(patch)),
        "notes": len(notes),
        "overrides": applied_overrides,
        "sampleRate": sample_rate,
        "seconds": round(total_samples / sample_rate, 4),
        "ringDb": _ring_db(frames, sample_rate),
        "output": os.path.abspath(output),
    }


def main(argv):
    p = argparse.ArgumentParser(prog="surge_render.py", description="dotbeat Surge XT render sidecar")
    p.add_argument("--doctor", action="store_true", help="probe surgepy + factory path + patch count")
    p.add_argument("--list-patches", action="store_true", help="emit the factory patch listing as JSON")
    args = p.parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0
    if args.list_patches:
        surge = _create_surge(44100)
        root = _patches_root(_factory_data_path(surge))
        print(json.dumps({"patchesRoot": root, "patches": enumerate_patches(root)}))
        return 0

    raw = sys.stdin.read()
    if not raw.strip():
        raise UsageError("render mode needs a JSON request on stdin (or pass --doctor / --list-patches)")
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as e:
        raise UsageError(f"stdin was not valid JSON: {e}")
    result = render(request)
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
        print(SURGEPY_BUILD_HINT, file=sys.stderr)
        sys.exit(3)
    except RenderError as e:
        print(f"render error: {e}", file=sys.stderr)
        sys.exit(4)

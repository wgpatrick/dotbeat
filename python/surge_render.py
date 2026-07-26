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

  --doctor            probe surgepy availability + Surge content path + per-pool patch counts +
                      whether this build carries the host-tempo binding
  --list-patches      emit the whole patch listing as JSON
                      {pools:[...], patches:[{name,category,path,pool,bank}]}
  --dump-params P     emit one patch's parameters with NATIVE value + range, as JSON — what a
                      local search needs to start AT a preset and bound how far it may travel
  (default / render)  read one render request as JSON on STDIN, write a WAV, print metadata JSON

  render stdin JSON:  {"patch": "<abs .fxp path>",
                       "notes": [{"midi": 48, "startSeconds": 0.0,
                                  "durationSeconds": 0.5, "velocity": 100}, ...],
                       "overrides": [{"param": "cutoff", "value": 0.62}, ...],  # optional, 0..1
                       "nativeOverrides": [{"param": "A Filter 1 Cutoff", "value": 10.0}, ...],
                       "tempo": 128,          # optional BPM; omitting it renders at Surge's 120
                       "sampleRate": 44100,
                       "output": "<abs .wav path>"}
  render stdout JSON: {"backend":"surge","patch","patchName","category","notes","overrides",
                       "nativeOverrides","tempo","tempoApplied","sampleRate","seconds","output"}

  TWO OVERRIDE SPELLINGS, on purpose. `overrides` is the original Track 1a surface and is
  documented/validated as normalized 0..1 — but surgepy's setParamVal takes the parameter's NATIVE
  value, so on this build that path reaches only the 0..1 slice of each parameter's real range
  ("A Filter 1 Cutoff" spans -60..70 = 13.75 Hz..14 kHz; 0..1 reaches 440.00..466.16 Hz).
  Parameters whose native range happens to BE 0..1 (resonance, EG sustain) were unaffected, which
  is how it went unnoticed. `overrides` is left untouched — redefining it would reinterpret every
  render cached against it (cli/surge-render-prep.mjs hashes the list) — and `nativeOverrides`
  is the additive path that covers the real range, clamped to each parameter's own [min, max] and
  echoed back with the applied value and Surge's own display string.

TWO POOLS, ONE TEMPO. Both fixed 2026-07-26: this sidecar used to enumerate `patches_factory` only
(639 of 3,559 installed .fxp) and never told Surge the project tempo (every synced LFO/delay/arp ran
at 120 BPM regardless of the batch). See PATCH_POOLS and TEMPO_BINDING_HINT below; an explicit
`tempo` on a build without the binding is a loud exit-4, never a silent mistimed render.
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


# surgepy upstream hard-codes `surge->time_data.tempo = 120` in createSurge() and binds NOTHING
# tempo-related (verified by dir() on the built instance, 2026-07-26 — no setTempo/bpm/time member),
# so every clip this sidecar ever rendered ran its tempo-synced LFOs, delays and envelopes at
# 120 BPM no matter what the project bpm was (research 132 §2.3, 140 D6). The fix is a 25-line local
# patch to the binding, checked in at python/surge-patches/0001-surgepy-expose-host-tempo.patch, and
# this sidecar REFUSES to render at a tempo it cannot actually deliver rather than silently lying.
TEMPO_BINDING_HINT = (
    "This surgepy build has no setTempo() binding, so tempo-synced modulation cannot be rendered "
    "at the project tempo. Apply python/surge-patches/0001-surgepy-expose-host-tempo.patch to the "
    "Surge XT source tree and rebuild the surgepy target, then reinstall the module "
    "(see python/README.md)."
)

# What Surge assumes when nobody tells it otherwise; also what every pre-fix render used.
DEFAULT_TEMPO_BPM = 120.0


def _has_tempo_binding(surge):
    """True iff this surgepy build exposes the host-tempo setter."""
    return callable(getattr(surge, "setTempo", None))


def _apply_tempo(surge, tempo, required):
    """Set the host tempo on `surge` and return (tempoApplied: bool, tempoBpm: float).

    MUST be called AFTER loadPatch(): surgepy's loadPatchPy re-applies `storage.unstreamedTempo`
    when the patch streams a tempo of its own, which would silently overwrite an earlier setting.

    `required` is True when the caller explicitly asked for a tempo. In that case a build without
    the binding is a loud RenderError — the whole point of D6 is that a mistimed render must never
    again pass silently. When the caller asked for nothing we fall back to Surge's own 120 BPM and
    say so in the metadata.
    """
    tempo = float(tempo)
    if not (0.0 < tempo <= 1000.0):
        raise UsageError(f"tempo must be in (0, 1000] BPM, got {tempo}")
    if not _has_tempo_binding(surge):
        if required:
            raise RenderError(f"cannot render at {tempo:g} BPM: {TEMPO_BINDING_HINT}")
        print(f"warning: no setTempo binding; rendering at Surge's default {DEFAULT_TEMPO_BPM:g} BPM", file=sys.stderr)
        return False, DEFAULT_TEMPO_BPM
    try:
        surge.setTempo(tempo)
    except Exception as e:  # pragma: no cover - needs a real surgepy build
        raise RenderError(f"could not set tempo to {tempo:g} BPM: {e}")
    getter = getattr(surge, "getTempo", None)
    if callable(getter):
        seen = float(getter())
        if abs(seen - tempo) > 1e-3:
            raise RenderError(f"tempo did not take: asked for {tempo:g} BPM, Surge reports {seen:g}")
    return True, tempo


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


# The patch pools this sidecar enumerates, in order. EXPLICIT and testable on purpose: for two
# years the eval drew from `patches_factory` alone (639 .fxp) while `patches_3rdparty` sat beside it
# on disk with 2,920 more by 37 named designers — 82% of the installed library, invisible to every
# blind rating ever collected (research 132 §2.1, 141 §7). The layouts differ by exactly one level:
#
#   patches_factory/<Category>/<name>.fxp             -> bank "Surge XT Factory", category <Category>
#   patches_3rdparty/<Bank>/<Category>/<name>.fxp     -> bank <Bank>,             category <Category>
#
# `bankDepth` is how many directory components sit ABOVE the category. Adding a pool is one row.
PATCH_POOLS = (
    {"pool": "factory", "dir": "patches_factory", "bankDepth": 0, "bank": "Surge XT Factory"},
    {"pool": "thirdparty", "dir": "patches_3rdparty", "bankDepth": 1, "bank": None},
)

# D31 licensing posture, restated where the code acts on it: bank NAMES are provenance metadata and
# stay in local manifests; the third-party patch CONTENT carries the same unresolved upstream
# licence question as the factory set (surge#6741), so rendered audio remains eval-private and
# gitignore-gated exactly as before. Enumerating more patches changes nothing about that.


def _data_root(factory_path):
    """The Surge `resources/data` dir that holds the patch pools. Tolerant of the three shapes
    surgepy builds have returned: the data dir itself, a path already pointing INTO a pool, and a
    repo root one level up."""
    if not factory_path:
        return None
    norm = os.path.normpath(factory_path)
    pool_dirs = {p["dir"] for p in PATCH_POOLS}
    if os.path.basename(norm) in pool_dirs:
        return os.path.dirname(norm)
    if any(os.path.isdir(os.path.join(norm, p["dir"])) for p in PATCH_POOLS):
        return norm
    alt = os.path.join(norm, "resources", "data")
    if any(os.path.isdir(os.path.join(alt, p["dir"])) for p in PATCH_POOLS):
        return alt
    return norm if os.path.isdir(norm) else None


def patch_roots(factory_path):
    """Resolve PATCH_POOLS against `factory_path` -> [{pool, dir, root, bank, bankDepth, exists}].
    Every declared pool is reported whether or not it exists on disk, so `--doctor` can say WHICH
    pool is missing instead of silently rendering a smaller library."""
    data_root = _data_root(factory_path)
    out = []
    for spec in PATCH_POOLS:
        root = os.path.join(data_root, spec["dir"]) if data_root else None
        out.append({
            "pool": spec["pool"],
            "dir": spec["dir"],
            "root": root,
            "bank": spec["bank"],
            "bankDepth": spec["bankDepth"],
            "exists": bool(root and os.path.isdir(root)),
        })
    return out


def _patches_root(factory_path):
    """The factory pool's root, kept for callers that only want `patches_factory` (and for the
    doctor's `patchesRoot` field). New code should use patch_roots()."""
    for entry in patch_roots(factory_path):
        if entry["pool"] == "factory":
            return entry["root"]
    return None


def enumerate_pool(root, pool, bank_depth, fixed_bank=None):
    """Every .fxp under one pool root as {name, category, path, pool, bank}.

    `category` is the directory component at depth `bank_depth` (Surge's top-level patch category:
    Basses / Leads / Pads / Polysynths / Chords / Sequences / ...); `bank` is the component above
    it, or `fixed_bank` when bankDepth is 0. A patch too shallow to have a category gets "".
    """
    if not root or not os.path.isdir(root):
        return []
    out = []
    for path in glob.glob(os.path.join(root, "**", "*.fxp"), recursive=True):
        rel = os.path.relpath(path, root)
        parts = rel.split(os.sep)
        dirs = parts[:-1]  # directory components above the file
        category = dirs[bank_depth] if len(dirs) > bank_depth else ""
        if fixed_bank is not None:
            bank = fixed_bank
        else:
            bank = dirs[bank_depth - 1] if bank_depth >= 1 and len(dirs) >= bank_depth else ""
        name = os.path.splitext(os.path.basename(path))[0]
        out.append({
            "name": name,
            "category": category,
            "path": os.path.abspath(path),
            "pool": pool,
            "bank": bank,
        })
    return out


def enumerate_patches(factory_path_or_root):
    """List every .fxp across EVERY pool in PATCH_POOLS as {name, category, path, pool, bank}.

    Sorted by (category, bank, name) so the TS seeded pick is stable across machines with the same
    installed content. Accepts either a `resources/data` path or a legacy `patches_factory` path —
    both resolve through patch_roots(), so a caller that used to pass the factory root now
    transparently gets the whole library.
    """
    out = []
    for entry in patch_roots(factory_path_or_root):
        out.extend(enumerate_pool(entry["root"], entry["pool"], entry["bankDepth"], entry["bank"]))
    out.sort(key=lambda p: (p["category"].lower(), p["bank"].lower(), p["name"].lower()))
    return out


def doctor():
    """Probe surgepy availability + factory path + per-pool patch counts + the tempo binding. When
    surgepy is absent this stays a pure importlib/filesystem probe (no import); when present it
    constructs a synth to read the real factory path, and degrades to available:true/patchCount:null
    if that construction fails."""
    available = _surgepy_available()
    report = {
        "backend": "surge",
        "surgepy": {"available": available},
        "factoryPath": None,
        "patchesRoot": None,
        "patchCount": None,
        "pools": None,
        "tempoBinding": None,
    }
    if not available:
        report["surgepy"]["missing"] = ["surgepy"]
        report["surgepy"]["fix"] = SURGEPY_BUILD_HINT
        return report
    try:
        surge = _create_surge(44100)
        factory = _factory_data_path(surge)
        report["factoryPath"] = factory
        report["patchesRoot"] = _patches_root(factory)
        report["tempoBinding"] = _has_tempo_binding(surge)
        if not report["tempoBinding"]:
            report["tempoFix"] = TEMPO_BINDING_HINT
        pools = []
        total = 0
        for entry in patch_roots(factory):
            count = len(enumerate_pool(entry["root"], entry["pool"], entry["bankDepth"], entry["bank"]))
            total += count
            pools.append({"pool": entry["pool"], "root": entry["root"], "exists": entry["exists"], "patchCount": count})
        report["pools"] = pools
        report["patchCount"] = total
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


def _apply_native_overrides(surge, overrides):
    """Apply {param, value} overrides in Surge's OWN NATIVE UNITS, clamped to each parameter's
    reported [min, max]. Returns [{param, requested, applied, min, max, display}].

    WHY THIS EXISTS ALONGSIDE `overrides` (2026-07-26, preset-retargeting stream): surgepy's
    `setParamVal` takes the parameter's native value, NOT a 0..1 normalized one. The older
    `overrides` path documents itself as "normalized 0..1" and rejects anything outside that range,
    so on this build it can only ever reach a sliver of most parameters' ranges — measured on
    Basses/Theme.fxp, "A Filter 1 Cutoff" spans -60..70 (13.75 Hz .. 14 kHz) and the 0..1 window
    reaches 440.00 .. 466.16 Hz. Parameters whose native range happens to BE 0..1 (resonance,
    EG sustain) were unaffected, which is why the discrepancy went unnoticed.

    `overrides` is left exactly as it was rather than silently redefined: changing its meaning would
    reinterpret every cached render keyed on it (cli/surge-render-prep.mjs hashes the override list).
    Callers that want real range coverage pass `nativeOverrides`."""
    if not overrides:
        return []
    index = _index_patch_params(surge)
    applied = []
    for ov in overrides:
        if not isinstance(ov, dict) or "param" not in ov or "value" not in ov:
            raise UsageError(f"each nativeOverride needs 'param' and 'value', got {ov!r}")
        param = _resolve_override_param(ov["param"], index)
        requested = float(ov["value"])
        lo = float(surge.getParamMin(param))
        hi = float(surge.getParamMax(param))
        value = max(lo, min(hi, requested))
        try:
            surge.setParamVal(param, value)
        except Exception as e:  # pragma: no cover - needs a real surgepy build
            raise RenderError(f"could not set nativeOverride '{ov['param']}' = {value}: {e}")
        applied.append(
            {
                "param": param.getName(),
                "requested": requested,
                "applied": float(surge.getParamVal(param)),
                "min": lo,
                "max": hi,
                "display": str(surge.getParamDisplay(param)),
            }
        )
    return applied


def dump_params(patch_path, sample_rate=44100):
    """Every leaf parameter of `patch_path` with its native value and range — what a local search
    needs in order to start AT the patch and bound how far it may travel."""
    if not os.path.isfile(patch_path):
        raise RenderError(f"patch not found: {patch_path}")
    surge = _create_surge(sample_rate)
    try:
        surge.loadPatch(patch_path)
    except Exception as e:  # pragma: no cover - needs a real surgepy build
        raise RenderError(f"could not load patch {patch_path}: {e}")
    out = []
    for name, param in sorted(_index_patch_params(surge).items()):
        try:
            out.append(
                {
                    "name": param.getName(),
                    "key": name,
                    "value": float(surge.getParamVal(param)),
                    "min": float(surge.getParamMin(param)),
                    "max": float(surge.getParamMax(param)),
                    "type": str(surge.getParamValType(param)),
                    "display": str(surge.getParamDisplay(param)),
                }
            )
        except Exception:  # pragma: no cover - build-specific leaves
            continue
    return {"backend": "surge", "patch": os.path.abspath(patch_path), "count": len(out), "params": out}


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
    native_overrides = request.get("nativeOverrides") or []
    sample_rate = int(request.get("sampleRate") or 44100)
    output = request.get("output")
    # D6: an explicit `tempo` is the caller promising the render is tempo-accurate. Omitting it is
    # legal (and reproduces the historic behaviour) but is reported as tempoApplied:false.
    tempo_requested = request.get("tempo")
    tempo_required = tempo_requested is not None
    if tempo_required and not isinstance(tempo_requested, (int, float)):
        raise UsageError(f"render request 'tempo' must be a number in BPM, got {tempo_requested!r}")
    tempo = float(tempo_requested) if tempo_required else DEFAULT_TEMPO_BPM
    if not patch or not isinstance(patch, str):
        raise UsageError("render request needs a 'patch' path")
    if not output or not isinstance(output, str):
        raise UsageError("render request needs an 'output' wav path")
    if not isinstance(notes, list) or not notes:
        raise UsageError("render request needs a non-empty 'notes' list")
    if not isinstance(overrides, list):
        raise UsageError("render request 'overrides' must be a list of {param, value}")
    if not isinstance(native_overrides, list):
        raise UsageError("render request 'nativeOverrides' must be a list of {param, value}")
    if not os.path.isfile(patch):
        raise RenderError(f"patch not found: {patch}")

    surge = _create_surge(sample_rate)
    try:
        surge.loadPatch(patch)
    except Exception as e:  # pragma: no cover - needs a real surgepy build
        raise RenderError(f"could not load patch {patch}: {e}")

    # Tempo goes on AFTER loadPatch (loadPatchPy re-applies the patch's own streamed tempo) and
    # before any notes play, so synced LFOs/delays/arps run on the caller's grid from sample 0.
    tempo_applied, tempo_bpm = _apply_tempo(surge, tempo, tempo_required)

    # Track 1a: normalized param overrides, applied after the patch loads and before any notes play.
    applied_overrides = _apply_overrides(surge, overrides)
    # Preset retargeting (2026-07-26): the same idea in Surge's OWN units — see
    # _apply_native_overrides for why both spellings exist.
    applied_native = _apply_native_overrides(surge, native_overrides)

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
        "nativeOverrides": applied_native,
        "tempo": tempo_bpm,
        "tempoApplied": tempo_applied,
        "sampleRate": sample_rate,
        "seconds": round(total_samples / sample_rate, 4),
        "ringDb": _ring_db(frames, sample_rate),
        "output": os.path.abspath(output),
    }


def main(argv):
    p = argparse.ArgumentParser(prog="surge_render.py", description="dotbeat Surge XT render sidecar")
    p.add_argument("--doctor", action="store_true", help="probe surgepy + factory path + patch count")
    p.add_argument("--list-patches", action="store_true", help="emit the factory patch listing as JSON")
    p.add_argument("--dump-params", metavar="PATCH", help="emit one patch's parameters (native value + range) as JSON")
    args = p.parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0
    if args.dump_params:
        print(json.dumps(dump_params(args.dump_params)))
        return 0
    if args.list_patches:
        surge = _create_surge(44100)
        factory = _factory_data_path(surge)
        roots = patch_roots(factory)
        print(json.dumps({
            "patchesRoot": _patches_root(factory),
            "pools": [{"pool": r["pool"], "root": r["root"], "exists": r["exists"]} for r in roots],
            "patches": enumerate_patches(factory),
        }))
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

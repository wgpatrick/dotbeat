#!/usr/bin/env python3
"""Diagnostic harness for the Surge XT "right-ear ringing" bug (overnight B1 probe).

The owner heard "a really high pitchy, ringy noise... tends to be in the right ear" in blind-rated
factory-patch clips. Measured: 3 of 6 rendered factory patches (Pads/"Robochoir 2", Keys/"EP 1",
Plucks/"Magic Music Box") carry a narrow 4-8 kHz tonal peak up to -10 dB relative to spectrum max,
hard-panned RIGHT (one measured: L -48 dB vs R -19 dB at 4.6 kHz). Three unrelated patches all
ringing right-side smelled like a rendering bug, not patch character.

This harness renders a patch under controllable conditions (FX bypass, silence warmup, sample rate)
and reports PER-CHANNEL the worst narrow HF tonal peak plus its frequency, so we can flip one
variable at a time and watch the ring turn off.

Run with the surgepy venv + factory content, e.g.:

  SURGE_DATA_HOME=$HOME/Documents/dotbeat/tools/surge/resources/data \
    <repo>/python/.venv/bin/python scripts/debug-surge-ring.py

surgepy: python/.venv/lib/python3.10/site-packages/surgepy.cpython-310-darwin.so (source build).
API surface reference: tools/surge/src/surge-python/surgepy.cpp.
"""

import os
import sys

import numpy as np

FACTORY = os.environ.get(
    "SURGE_DATA_HOME", os.path.expanduser("~/Documents/dotbeat/tools/surge/resources/data")
)
PATCHES = os.path.join(FACTORY, "patches_factory")

TARGETS = {
    "Robochoir 2": "Pads/Robochoir 2.fxp",
    "EP 1": "Keys/EP 1.fxp",
    "Magic Music Box": "Plucks/Magic Music Box.fxp",
    "Helmeto": "Basses/Helmeto.fxp",  # known-clean control
}


def patch_path(name):
    return os.path.join(PATCHES, TARGETS[name])


# --- Surge fx_bypass values (src/common/Parameter / SurgeStorage) -------------------------------
# 0 = all fx, 1 = no sends, 2 = scene fx only? ... we resolve the "all off" value at runtime by
# reading getParamMax on the fx_bypass param and confirming its display string.


def find_named_param(surge, predicate):
    """Walk the cg_FX / cg_GLOBAL control groups and return the first SurgeNamedParamId whose name
    matches `predicate(name)`. Used to locate fx_bypass without hardcoding an id."""
    import surgepy

    for cg_id in (
        surgepy.constants.cg_GLOBAL,
        surgepy.constants.cg_FX,
    ):
        try:
            cg = surge.getControlGroup(cg_id)
        except Exception:
            continue
        for entry in cg.getEntries():
            for p in entry.getParams():
                if predicate(p.getName()):
                    return p
    return None


def set_fx_bypass_all_off(surge):
    """Set the global fx_bypass param to its 'All FX Off' value. Returns (found, display)."""
    p = find_named_param(surge, lambda n: n.strip().lower() in ("fx bypass", "fx_bypass", "bypass"))
    if p is None:
        return False, None
    mx = surge.getParamMax(p)
    surge.setParamVal(p, mx)
    return True, surge.getParamDisplay(p)


def clear_fx_types(surge):
    """Alternative bypass: set every FX slot's `type` param to 0 (fxt_off). Returns count set."""
    patch = surge.getPatch()
    n = 0
    for fx in patch["fx"]:
        t = fx.get("type")
        if t is None:
            continue
        try:
            surge.setParamVal(t, 0)
            n += 1
        except Exception:
            pass
    return n


def render(
    name,
    midis=(60, 64, 67),
    note_seconds=4.0,
    tail_seconds=1.5,
    sample_rate=44100,
    warmup_blocks=0,
    bypass_fx=False,
    velocity=100,
):
    """Render a sustained chord through a patch and return the stereo float array (N, 2)."""
    import surgepy

    surge = surgepy.createSurge(sample_rate)
    surge.loadPatch(patch_path(name))
    block = surge.getBlockSize()

    bypass_display = None
    if bypass_fx:
        _, bypass_display = set_fx_bypass_all_off(surge)

    # Optional silence warmup: let LFO / modulation / FX state settle before the first note-on.
    for _ in range(warmup_blocks):
        surge.process()

    total = int(round((note_seconds + tail_seconds) * sample_rate))
    off = int(round(note_seconds * sample_rate))
    frames = np.empty((0, 2), dtype=np.float64)
    chunks = []

    played = False
    released = False
    pos = 0
    while pos < total:
        if not played:
            for m in midis:
                surge.playNote(0, m, velocity, 0)
            played = True
        if not released and pos >= off:
            for m in midis:
                surge.releaseNote(0, m, 0)
            released = True
        surge.process()
        out = np.asarray(surge.getOutput())  # (2, block)
        chunks.append(np.stack([out[0], out[1] if out.shape[0] > 1 else out[0]], axis=1))
        pos += block

    frames = np.concatenate(chunks, axis=0)[:total]
    return frames, bypass_display


def ring_analysis(frames, sample_rate, lo=4000.0, hi=14000.0):
    """Per-channel worst narrow HF tonal peak. Returns list of dicts, one per channel:
      {peakDb, peakHz, broadband}  where peakDb is dB relative to that channel's spectrum max.
    Mirrors surge_render._ring_db's detector but reports frequency and keeps channels separate."""
    n_fft = 8192
    if frames.shape[0] < n_fft:
        return []
    window = np.hanning(n_fft)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    band = (freqs > lo) & (freqs < hi)
    band_freqs = freqs[band]
    # ~300 Hz neighborhood half-width in bins
    bin_hz = sample_rate / n_fft
    half = max(1, int(round(300.0 / bin_hz)))
    out = []
    for ch in range(frames.shape[1]):
        y = frames[:, ch]
        mags = [
            np.abs(np.fft.rfft(y[s : s + n_fft] * window))
            for s in range(0, len(y) - n_fft, n_fft)
        ]
        spectrum = np.mean(mags, axis=0)
        smax = spectrum.max() + 1e-12
        sband = spectrum[band]
        worst_db = -120.0
        worst_hz = None
        for i in range(len(sband)):
            neigh = np.median(sband[max(0, i - half) : min(len(sband), i + half)]) + 1e-15
            if sband[i] > 6 * neigh:
                db = 20 * np.log10(sband[i] / smax)
                if db > worst_db:
                    worst_db = db
                    worst_hz = float(band_freqs[i])
        out.append({"peakDb": round(worst_db, 1), "peakHz": round(worst_hz, 1) if worst_hz else None})
    return out


def fmt(res):
    parts = []
    for ch, r in zip(("L", "R"), res):
        parts.append(f"{ch} {r['peakDb']:>6} dB @ {r['peakHz']} Hz")
    return "  |  ".join(parts)


def run_case(label, **kw):
    frames, byp = render(**kw)
    sr = kw.get("sample_rate", 44100)
    res = ring_analysis(frames, sr)
    extra = f"  bypass={byp}" if byp else ""
    print(f"  {label:<28} {fmt(res)}{extra}")
    return res


def main():
    names = sys.argv[1:] or ["Robochoir 2", "EP 1", "Magic Music Box", "Helmeto"]
    for name in names:
        print(f"\n=== {name} ===")
        run_case("baseline 44.1k", name=name)
        run_case("fx bypass 44.1k", name=name, bypass_fx=True)
        run_case("warmup 200blk 44.1k", name=name, warmup_blocks=200)
        run_case("baseline 48k", name=name, sample_rate=48000)


if __name__ == "__main__":
    main()

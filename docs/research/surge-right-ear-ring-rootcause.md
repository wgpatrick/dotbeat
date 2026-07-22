# Surge XT "right-ear ringing" — root cause (B1 probe, 2026-07-21)

## Symptom

The owner heard "a really high pitchy, ringy noise... tends to be in the right ear" in blind-rated
Surge factory-patch clips. Measured: 3 of 6 rendered factory patches (Pads/"Robochoir 2",
Keys/"EP 1", Plucks/"Magic Music Box") carried a narrow 4-8 kHz tonal peak up to -10 dB relative to
spectrum max, hard-panned RIGHT (one measured: L -48 dB vs R -19 dB at 4.6 kHz). Three unrelated
patches all ringing right-side smelled like a rendering bug, not patch character. The owner was
right.

## Root cause (definitive)

**`surgepy`'s `getOutput()` builds its numpy array with the wrong strides**, so the right channel it
hands back is *the left channel delayed by 2 samples*, spliced with a 2-sample discontinuity at each
32-sample block boundary. That intra-block delay comb-filters the signal and the block-periodic
discontinuity injects energy at multiples of `44100/32 = 1378 Hz`; the net audible result is a
hard-panned-right high-frequency comb/ring. Our sidecar consumed `getOutput()` per block, so every
Surge render dotbeat produced carried this artifact.

### The buggy code

`tools/surge/src/surge-python/surgepy.cpp`, `getOutput()`:

```cpp
py::array_t<float> getOutput()
{
    return py::array_t<float>({2, BLOCK_SIZE}, {2 * sizeof(float), sizeof(float)},
                              (const float *)(&output[0][0]));
}
```

The engine's output buffer is `float output[N_OUTPUTS][BLOCK_SIZE]` (channel-major, contiguous:
`L0..L31, R0..R31`). A `(2, BLOCK_SIZE)` view of that memory must have strides
`{BLOCK_SIZE * sizeof(float), sizeof(float)}` = `{128, 4}` at block size 32. Instead it hardcodes
`{2 * sizeof(float), sizeof(float)}` = `{8, 4}` — an *interleaved* stride pattern that does not match
the channel-major buffer.

Because the `py::array_t` is constructed with no owner `base` handle, pybind11 **copies** the source
through those strides into a fresh C-contiguous array. So the returned array *reports* clean strides
`(128, 4)` (which fooled a first-pass stride check) but its data was already gathered wrong:

- row 0 (left): floats 0,1,...,31 -> `output[0][0..31]` — correct left.
- row 1 (right): floats 2,3,...,33 -> `output[0][2..31]`, `output[1][0]`, `output[1][1]` — the LEFT
  channel shifted by 2 samples, with 2 genuine right samples at the block boundary.

### Proof chain (all reproducible via `scripts/debug-surge-ring.py` and the transcript below)

1. **Per-channel analysis** of the 3 bad patches + Helmeto control: a narrow ~4.3-4.9 kHz tone
   present in R, absent in L, at identical broadband RMS between channels (no whole-signal panning).
2. **FX Chain Bypass = "All FX Off"** and **Width = 0** (mono collapse) both FAIL to remove it —
   not patch FX, not the stereo-width stage.
3. **Silence render** (no notes) = pure digital zero (-240 dBFS) both channels — not engine
   startup / denormal / uninitialized-buffer state.
4. **Default init patch** (plain centered saw, no `loadPatch`) shows the SAME right-biased comb —
   so it is not patch content at all.
5. **Cross-correlation** L vs R for the default (mono) patch peaks at **lag -2 samples** (corr 0.94)
   rather than lag 0 — R is a ~2-sample-delayed copy of L.
6. **`processMultiBlock` (the C++ memcpy path) vs the `getOutput` per-block loop**, same note, same
   patch: `processMultiBlock` gives **L == R exactly (corr 1.0000 at lag 0)** — a centered saw is
   genuinely mono — while the `getOutput` loop gives an 80.7 dB R-vs-L comb. The bug is in
   `getOutput`, not Surge's DSP.
7. **Raw-sample proof**: `out[1][0:6] == out[0][2:8]` -> **True**. The right row IS the left row
   shifted by 2 samples. `out[1][30], out[1][31]` hold the only 2 genuine right samples per block.

`processMultiBlock` copies the true channels (`memcpy(dR, output[1], ...)`), which is why it is
clean; it is the correct accessor to build the render on.

## Fix (shipped: `python/surge_render.py`, main @ `26cee6e`)

The sidecar no longer reads the broken 2-row `getOutput()`. It allocates one
`createMultiBlock(n_blocks)` buffer and renders one block at a time via `processMultiBlock(buf, b, 1)`
— dispatching every note-on/off due at that block boundary first, so events still land at their exact
sample-quantized positions — then reads the true stereo out of the buffer's channel-major memory
(`arr[0]` = left, `arr[1]` = right). `processMultiBlock` `memcpy`s `output[0]` and `output[1]`
separately, so both channels are correct. The `ringDb` screen stays in place as a safety net
regardless (it is cheap and catches any future regression or genuinely-ringy patch).

### Before / after (`_ring_db`, worst narrow 4-14 kHz peak vs spectrum max — less is better)

Measured with `scripts/debug-surge-ring.py`'s method, a sustained C-E-G chord (~4 s + tail), old
`getOutput()` path vs new `processMultiBlock` path:

| Patch                     | before (getOutput) | after (processMultiBlock) |
|---------------------------|-------------------:|--------------------------:|
| Pads / Robochoir 2        |            -30.6   |                   -32.1   |
| Keys / EP 1               |            -19.7   |                   -81.1   |
| Plucks / Magic Music Box  |            -17.5   |                   -40.0   |
| Basses / Helmeto (control)|            -28.2   |                  -120.0   |

The shipped showdown pipeline (its own note conversion) corroborates: Robochoir 2 -17.3 -> -34.3,
EP 1 -> -82.3, Magic Music Box -> -38.9. Note the **control**: Helmeto (a mono bass we had assumed
clean) also carried the artifact before the fix (-28.2) and renders **dead clean afterward**
(-120.0) — confirming the bug affected *every* Surge render, not just the three flagged patches, and
that the fix removes it rather than merely attenuating a loud few.

## This is an UPSTREAM surgepy bug — report it

The defect is in Surge XT's own `surge-python` bindings, not dotbeat code. Draft issue text for the
Surge XT project (github.com/surge-synthesizer/surge):

---
**Title:** `surgepy` `getOutput()` returns wrong strides — right channel is left delayed by 2 samples

**Body:**

`SurgeSynthesizerWithPythonExtensions::getOutput()` (src/surge-python/surgepy.cpp) constructs its
array as:

```cpp
return py::array_t<float>({2, BLOCK_SIZE}, {2 * sizeof(float), sizeof(float)},
                          (const float *)(&output[0][0]));
```

The engine buffer is `float output[N_OUTPUTS][BLOCK_SIZE]` (channel-major). The correct strides for a
`(2, BLOCK_SIZE)` view are `{BLOCK_SIZE * sizeof(float), sizeof(float)}`, not
`{2 * sizeof(float), sizeof(float)}`. Because the array is constructed without an owning `base`,
pybind11 copies the data through the given strides, so the returned array reports contiguous strides
but its right row is actually `output[0]` shifted by 2 samples spliced with 2 genuine right samples
per block.

Reproduce (default init patch is a centered mono saw, so L and R must be identical):

```python
import numpy as np, surgepy
s = surgepy.createSurge(44100); s.playNote(0, 60, 100, 0)
for _ in range(200): s.process()
o = np.asarray(s.getOutput())
assert np.array_equal(o[1][0:6], o[0][2:8])   # right row == left row shifted +2  -> PASSES (bug)

s2 = surgepy.createSurge(44100); s2.playNote(0, 60, 100, 0)
arr = s2.createMultiBlock(200); s2.processMultiBlock(arr); mb = np.asarray(arr)
assert np.array_equal(mb[0], mb[1])           # processMultiBlock is correct -> L == R exactly
```

Fix: use `{(size_t)BLOCK_SIZE * sizeof(float), sizeof(float)}` for the strides (matching
`processMultiBlock`, which memcpys `output[0]` and `output[1]` separately and is correct).
---

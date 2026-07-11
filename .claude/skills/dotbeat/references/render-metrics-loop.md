# The render → metrics → critique → re-render loop

Metrics-first critique is a load-bearing design decision (`docs/decisions.md` D2): deterministic
DSP measurements (LUFS, spectral balance, crest, stereo width) are ground truth; an LLM narrates
the deltas and proposes a `.beat` edit from them, but never judges loudness/balance "by ear" or
invents a number. The loop:

1. `beat render <file> -o out.wav [--beatlab-dir <p> | --offline]` (or `beat_render`).
2. `beat metrics out.wav` (or `beat_metrics`) — read integrated LUFS, true peak, crest factor,
   spectral band percentages (sub/bass/mids/presence/air), stereo correlation/width.
3. `beat lint out.wav [--target <LUFS>]` (or `beat_lint`) — the same metrics run through
   deterministic threshold rules (loudness vs target, over-compression, spectral imbalance, mono/
   phase risk), each finding stated as a measured value vs a threshold, and — where expressible —
   the `.beat` edit to try.
4. Propose a `.beat` edit that addresses the *measured* finding (not a vibe): e.g. a "low-end-heavy"
   finding → pull a bass-heavy track's `volume` down or its `cutoff` down; a "dull-top-end" finding
   → raise a bright-source track's `cutoff`; a loudness-under-target finding → raise `volume`
   across tracks; a "effectively-mono" finding → spread `pan` on non-bass tracks.
5. `beat set` the edit(s), re-render, re-measure. Accept when the target metric is close enough
   (there will usually be a residual — see below, being honest about it beats forcing a perfect
   number); otherwise iterate with a corrective edit informed by the *new* measurement (e.g. if a
   prior round overshot the loudness target after also opening a filter, the correction is a small
   pull-back, not blind repetition of the same move).

## Worked example (real, from `docs/sessions/2026-07-10-claude-over-mcp.md`)

Setup: a 4-track groove, offline-render path, target -23.5 LUFS (the -14 LUFS streaming target
mapped through the measured 9.5 LU offline-vs-browser offset — see the caveat below).

**Round 0 — baseline**: `beat_inspect` → 4 tracks; all `pan 0`; lead/chords cutoffs 3200/3500 Hz.
`beat_render` → `beat_metrics`: **-27.53 LUFS**, width **-39.3 dB** (near-mono), spectrum 80% below
250 Hz, 0.3% above 2 kHz. `beat_lint` → 4 findings: under target, low-end-heavy, dull-top-end,
effectively-mono.

**Round 1 — proposal from the findings**: raise all four `volume`s +4 dB (the loudness finding's
own suggestion); pan chords -0.35 / lead +0.35, keep kick/bass centered (the mono finding, club
mixing convention); open lead cutoff 3200→6500 Hz, chords 3500→4500 Hz (dull-top-end; the lead's
square wave is the best available harmonics source). One `beat_set` call, 8 edits. Re-render +
re-measure: **-22.42 LUFS** (overshot the target by ~1 LU — the filter opens added energy on top of
the volume moves), width **-14.2 dB** (25 dB improvement). Loudness and mono findings clear;
low-end-heavy (77%) and dull-top-end (0.9%) persist.

**Round 2 — correction from the overshoot**: pull bass `volume` -1.5 dB (fixes the loudness
overshoot *and* is the direct low-end lever); push lead `cutoff` to 8000 Hz. Re-render + re-measure:
**-22.78 LUFS** (0.72 LU from target), width -13.6 dB, low-end share 80→77→74% trending right,
>2 kHz energy 0.3→0.9→1.1%.

**Verdict**: accepted with honest residuals. Distance to the loudness target went 4.03 LU → 0.72 LU
in 2 rounds, ~25s of rendering, purely from render→measure→edit, no listening. The residual
low-end-heavy/dull-top-end findings were NOT papered over — the session recorded two honest
reasons (the groove genuinely is bass-forward, so a generic threshold may be the wrong target; and
the strongest available presence lever, per-lane drum gain, wasn't a format lever at the format
version in use at the time).

**What this proves about the architecture**: the agent never needed to *hear* anything. Round 1's
overshoot was caught by re-measurement, not by ear; round 2's correction followed arithmetically
from the numbers. That's the point of D2 — trust the measurement, narrate it, propose from it.

## Current environment caveat (verify before assuming render "just works")

As of this writing, `beat render` (`cli/render.mjs`, the Chromium path) requires a BeatLab checkout
(`--beatlab-dir` or `BEATLAB_DIR`), and `beat render --offline` (`cli/render-offline.mjs`) also
requires a BeatLab checkout **and** a locally-patched `node-web-audio-api` native build that is not
part of a normal `npm install` — without it, `--offline` renders **total silence with no error**,
not a degraded result (confirmed in this checkout: neither `BEATLAB_DIR` nor a patched
`node-web-audio-api` build is present). `docs/decisions.md` D15 records the decision to retarget
`beat render` onto dotbeat's own `ui/src/audio/engine.ts` (no BeatLab dependency at all) and retire
`--offline`'s broken BeatLab-dependent path; `docs/phase-17-plan.md` Stream L is the execution plan
for that, and may or may not have landed by the time this skill is read. Before trusting a render:
check `cli/render.mjs`'s own top-of-file comment/usage for whether it still requires
`--beatlab-dir`, and if a WAV comes back suspiciously short/silent, check for the
`node-web-audio-api.build-release.node` warning `render-offline.mjs` prints rather than assuming
the mix is actually silent.

## Cross-path calibration (if using the browser/Chromium path vs `--offline`, historically)

The two render paths were measured to differ by a **constant 9.5 LU** (offline vs browser), traced
to differing `DynamicsCompressor` auto-makeup formulas between the Rust engine and Chromium's own
implementation — linear, not a bug, so it's a fixed offset to apply when translating a
streaming-platform LUFS target (e.g. -14) into an offline-path target (e.g. -23.5), not something
to "fix" by tuning. Never compare a render from one path against a render from the other without
applying this offset (or better, stay on one path for an entire iteration loop and only translate
the final number).

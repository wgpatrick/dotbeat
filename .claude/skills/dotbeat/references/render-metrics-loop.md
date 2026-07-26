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
mapped through the then-measured 9.5 LU offline-vs-browser offset). **That offset is history** —
it was pre-D15, between two different engines; today both render paths share one engine and you
target the streaming number directly. See "Cross-path calibration" below. The *loop* below is what
to copy; the specific target number is not.

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

## Current environment (D15 landed — no BeatLab, no patched native build)

`beat render` drives **dotbeat's own** engine (`ui/src/audio/engine.ts`) headless: it boots the
daemon on the .beat file, serves a production `ui/` build, loads it in headless Chromium, and
captures the live post-limiter master. There is no BeatLab dependency and no separate repo — see
`cli/render.mjs`'s own header. `--beatlab-dir` is accepted only as a swallowed no-op for old
scripts; `BEATLAB_DIR` does nothing.

`beat render --offline` computes the mix through an `OfflineAudioContext` built on the **same**
`Engine` class (`ui/src/audio/offline.ts`, D22/D23) instead of capturing the realtime clock — no
`node-web-audio-api`, no patched native build, no silent-WAV failure mode. `cli/render-offline.mjs`
and `scripts/build-headless-engine.mjs` were **deleted** with D15 (Phase 17 Stream L); any doc or
memory telling you to check `render-offline.mjs`'s startup warning is describing a path that no
longer exists.

What `--offline` *does* still refuse, loudly and by name (not silently): soundfont projects
(instrument tracks / sf-backed drum lanes) fall back to live capture with the reason printed, and
an active `bitcrushRate` degrades to passthrough with a printed caveat. It is CPU-bound, so it is
fast on short clips and can be *slower* than live capture on long dense songs — the measured
realtime ratio is printed every run. Requirements today are just `npm run build` plus a Chromium
(bundled Playwright, or `CHROME_PATH`).

## Cross-path calibration (live capture vs `--offline`)

Since D15 both paths run the same engine code, so there is **no** loudness offset to apply — pick
your LUFS target directly (e.g. -14 for a streaming spec) on whichever path you are using. The
parity gates (smoke/real-groove/voxtest) hold live and offline to the bounds in
`src/metrics/variance.ts`; on the full-song gate LUFS agrees to Δ0.19 and RMS to Δ0.12.

Three known live-chain exceptions remain, all traced to the live path's MediaRecorder→opus step,
and in every one **the offline number is the trustworthy one** (D23): peak-domain on a
limiter-pinned dense mix (live reads ~1 dB hotter — −1.5 vs −2.5 dBTP — because lossy-codec
overshoot, verified by round-tripping the offline WAV through the same codec: +0.45 dB), mono-width
opus noise, and sub-band tilt. Energy metrics (LUFS, RMS, band shares, correlation) are comparable
across paths; **true-peak/crest are not** — don't chase a ~1 dB peak difference between a live and
an offline render of the same file, and prefer staying on one path for an entire iteration loop.

> **Historical note.** A **constant 9.5 LU** offline-vs-browser offset is quoted in the Phase 4
> docs, `ROADMAP.md`, and the worked example above (which is why it targets -23.5 LUFS rather
> than -14). That measurement was between *BeatLab's Rust `node-web-audio-api` engine* and
> Chromium's `DynamicsCompressor`, i.e. between two different implementations. D15 collapsed both
> CLI paths onto one engine and the offset went with it. **Do not apply it today.**

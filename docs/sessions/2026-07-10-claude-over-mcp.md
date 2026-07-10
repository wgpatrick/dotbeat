# Session log: Claude drives `beat mcp` — the literal M3 exit criterion

> ROADMAP M3's exit test: *"Claude, given only the repo + MCP, can render a project, read its
> metrics, and propose an accepted-or-rejected diff that measurably moves LUFS toward a target."*
> This is the transcript of that actually happening (2026-07-10). Every tool call below went over
> the real MCP JSON-RPC stdio protocol (`scripts/mcp-call.mjs` → `beat mcp`); every number came
> from the deterministic DSP tools; Claude's role was exactly D2's: narrate the measurements,
> propose edits, accept or reject by re-measurement — never generate a number.

**Setup:** `examples/real-groove.beat` copied to a fresh git repo as `song.beat`, committed as
baseline. Offline renders (~10 s each). Loudness target: the -14 LUFS streaming point, mapped
through Phase 4's measured 9.5 LU offline offset → **-23.5 LUFS offline-path target** (the agent
applying the docs' own cross-path calibration guidance).

## Round 0 — look, render, measure

- `beat_inspect` → 4 tracks, 126 bpm; every track at `pan 0`; lead/chords cutoffs 3200/3500.
- `beat_render` (offline) → v0.wav. `beat_metrics` → **-27.53 LUFS**, width **-39.3 dB**,
  spectrum 80% below 250 Hz, 0.3% above 2 kHz.
- `beat_lint` (target -23.5) → four findings: 4.0 LU under target; low-end-heavy; dull-top-end;
  effectively-mono.

## Round 1 — proposal (from the findings, mapped to `.beat` levers)

> Judgment: raise all four volumes +4 dB (loudness finding's own suggestion); keep kick/bass
> centered and pan chords -0.35 / lead +0.35 (mono finding, club convention); open lead
> 3200→6500 Hz and chords 3500→4500 Hz (dull-top-end — the lead's square wave is the best
> available harmonics source).

- `beat_set` (8 edits, one call) → edit list confirmed each change.
- Re-render + `beat_metrics` → **-22.42 LUFS** (target -23.5 — overshot ~1 LU: the filter opens
  added energy on top of the volume moves), width **-14.2 dB** (25 dB improvement).
- `beat_lint` → loudness and effectively-mono findings **cleared**; low-end-heavy (77%) and
  dull-top-end (0.9%) persist.

## Round 2 — correction (measured overshoot drives the next edit)

> Judgment: pull bass -1.5 dB — fixes the loudness overshoot AND is the low-end lever; push
> lead to 8000 Hz.

- `beat_set` (2 edits) → re-render → **-22.78 LUFS** (0.72 LU from target), width -13.6 dB,
  low-end share 80→77→74% trending right, >2 kHz energy 0.3→0.9→1.1%.

## Verdict — accept, with honest residuals

**Accepted** (committed; `beat diff --git HEAD~1 HEAD song.beat` is the record):

```
drums: volume -10 -> -6
bass: volume -8 -> -5.5
chords: volume -14 -> -10
chords: cutoff 3500 -> 4500
chords: pan 0 -> -0.35
lead: volume -14 -> -10
lead: cutoff 3200 -> 8000
lead: pan 0 -> 0.35
```

**Exit criterion met:** distance to the loudness target went **4.03 LU → 0.72 LU**, through
proposed-then-verified diffs, over the MCP protocol, with the render/measure/edit tools doing
all the hearing.

**Residual findings, not papered over:** low-end-heavy (74%) and dull-top-end (1.1%) remain.
Two honest reasons: (a) this groove *is* bass music — the lint thresholds encode a generic
rule of thumb, and a genre-aware target would disagree; (b) the strongest available presence
source (hat level) is **not a v0.2 format lever** — the drum instrument levels are engine
constants, only the shared drum-bus params are in the file. That's a real format-roadmap
finding produced by the loop itself: per-lane drum gain belongs on the format wishlist.

## What this says about the architecture

The research-mandated shape (D2: metrics judge, LLM narrates) held up in practice: at no point
did the agent need to *hear* anything — the overshoot in round 1 was caught by re-measurement,
not by ear, and the round-2 correction followed arithmetically. The loop converged in 2
iterations, ~25 s of rendering total, no browser.

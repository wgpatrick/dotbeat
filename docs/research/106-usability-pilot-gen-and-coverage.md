# Research 106 — Usability pilot: `beat source gen` + silent-render coverage warning

**Date:** 2026-07-14
**Type:** CLI/MCP usability pilot (exploratory, no checklist)
**Surfaces tested:** `beat source gen` (stub backend), the song-mode silent-render coverage
warning, plus the surrounding gen → lane/clip → scene → song → render flow across both the CLI
and the MCP server.

## Goal & setup

Play a hurried producer making a short beat who wants to **generate custom one-shots from text
prompts**, build them into a track, arrange a scene/song, and render something audible — discovering
the whole flow only from `--help`, tool descriptions, and errors. Real generative models aren't
installed here, so part of the test is whether the stub/degraded path is discoverable and honestly
labeled. Specifically probed: (1) is the `media/<id>.wav.json` provenance sidecar sensible; (2) does
the stub honestly signal it's not a real model; (3) does the silent-render warning fire when you
forget to place a track, and does completing the placement clear it.

Working dir: `/tmp/pilot106`. CLI entry `node /home/user/dotbeat/cli/beat.mjs`. MCP driven over
stdio with a ~20-line JSON-RPC client (`/tmp/pilot106/mcp-call.mjs`). ~30 commands total, ~10 min.

## Session narration

**Discovery.** `beat --help` is huge but `source gen` is clearly listed with its flags. `beat
source gen --doctor` returned clean JSON: `stub: ok`, `stableaudio: {ok:false, missing:[torch,
stable_audio_tools]}`. Honest and immediately useful.

**Degraded path.** As a hurried user I ran gen with the *default* backend (stableaudio, not
installed):
```
error: beat source gen (stableaudio) failed: pip install -r python/requirements-stableaudio.txt —
run `beat source gen --doctor` to check the Python backends, or `--backend stub` for a
deterministic dependency-free tone bed
```
Excellent error — names the fix, points at `--doctor` *and* `--backend stub`. Same actionable
`isError` came back through MCP (`beat_source_gen` with no backend). This is the degraded path done
right.

**Generating.** `source gen beat.beat kick1 "deep punchy 808 kick drum one shot" --seconds 1
--backend stub` →
```
registered kick1: sha256:110ddc76f2b8... media/kick1.wav (1s, license Stability-AI-Community)
provenance sidecar: media/kick1.wav.json
```
Sidecar (`media/kick1.wav.json`) is sensible and honest at the top level:
`"source": "generated:stub"`, `generated:{provider:"stub", model:"stub-0.1.0", backend:"stub",
prompt, seconds, seed}`. A careful reader can tell it's a stub. Determinism claim holds: same
prompt+seed=0 → byte-identical sha256 across two runs.

**Building the track.** Added a 12-lane drums track, backed `kick`←kick1 and `hat`←perc1 via `beat
lane`, added 8 four-on-the-floor kicks + 8 offbeat hats, snapshotted to a `drumloop` clip. Added an
`audio` track `pad` with an `audio-clip` from a generated `texture1`. All smooth, good confirmation
lines at each step.

**The coverage warning.** Deliberately built scene `A` with `drums=drumloop` only (forgetting the
pad), then `song A 2`. `inspect` ended with:
```
⚠ track 'pad' has content in 1 clip but is placed in no scene — song mode won't play it
  (snapshot with beat clip, then beat scene / beat place)
```
It fired again *during* `render` (before the Chromium spin-up), which is exactly where a hurried
producer needs it. Note the `lead` track (empty) correctly did **not** warn — the check is
content-gated, not just placement-gated. `beat place A pad padclip 0` → the warning cleared on the
next `inspect` and render. Full loop works end to end.

**Render.** `beat render` auto-found the bundled Chromium (`Chrome unavailable; falling back to
Playwright's bundled chromium`) with no config — rendered 4.0s in ~8.5s, first try, no hang.
`metrics` on the mix showed real audio (-18.5 LUFS, bass-dominated by the kick). Confirmed the pad
placement actually changed the render (mix-before vs mix-after have different sha256; the near-
identical *spectrum* readout is just the loud kick dominating the percentage bands, not a dropped
track — verified the pad renders at -8.0 LUFS in its solo stem).

**MCP parity.** `tools/list` = 66 tools; `beat_source_gen`'s description is thorough and explicitly
documents the stub as "a deterministic, dependency-free tone bed (same seed+seconds → byte-identical
audio)." `beat_inspect` surfaces the same coverage warning text as the CLI. `beat_unplace` /
`beat_place` round-tripped the warning on and off. Good CLI/MCP consistency.

**The prompt-independence discovery.** Generating a *snare* via MCP —
`beat_source_gen(sample_id:"snare1", prompt:"tight snappy snare", backend:"stub")` at the default
seed 0 — produced sha256 `110ddc76f2b8...`, **byte-identical to kick1** ("deep punchy 808 kick drum
one shot"). Confirmed: kick1 == snare1 (different prompts, both seed 0); a re-gen of the kick prompt
at seed 99 differs. So stub output is a pure function of `(seed, seconds)` and **ignores the prompt
entirely**. Post-hoc source read (`python/gen.py:91` `run_stub`) confirms this is by design — the
comment says "It does NOT interpret the prompt — it just proves the plumbing," and
`freq = 110.0 + (seed % 12) * 55.0`, i.e. only 12 distinct tones keyed off `seed % 12`. Intended,
but a real trap at the CLI surface (see M1). The earlier illusion that the stub "varied by prompt"
was just me happening to use different seeds (0/42/7).

## Findings (severity-ranked)

### M1 — medium: stub ignores the prompt; a kit built at the default seed is byte-identical, unsignaled
**Repro:** `source gen f kick1 "808 kick" --backend stub` and `source gen f snare1 "tight snare"
--backend stub` (both default seed 0) → identical sha256 `110ddc76f2b8...`. A producer building a
kit from distinct prompts ("kick", "snare", "hat") at defaults gets the *same* sound N times, with
no hint — every success line looks like a distinct registration. The pipeline is honest in code
comments and the MCP description, but nothing the CLI user *sees* says "the prompt doesn't affect
stub audio; vary `--seed` to get different sounds."
**Fix direction:** cheapest — derive the default seed from a hash of the prompt so different prompts
sound different by default (still deterministic; keeps the same-seed→same-audio test guarantee).
Or: when a freshly generated file's sha256 matches existing media in the project, print a one-line
notice ("identical to media/kick1.wav — stub ignores the prompt; pass a distinct --seed"). At
minimum, add a stub-only line to the success output pointing at `--seed`.

### M2 — medium: stub media is stamped with the Stability AI Community License and a stability.ai license URL
**Repro:** `media/kick1.wav.json` from a `--backend stub` run contains
`"license": "Stability-AI-Community"` and `generated.licenseUrl:
"https://stability.ai/community-license-agreement"`, and the success line prints "license
Stability-AI-Community" — for a stdlib sine-plus-noise tone that no Stability model ever touched.
`source: "generated:stub"` is honest, but any downstream tool that keys off the `license` field
(lint/enforcement, export manifest) would treat a throwaway placeholder as a licensed Stability
output. **Fix direction:** for the stub backend, default the license to something like `"stub"` /
`"none"` and drop the `licenseUrl`, or explicitly `"placeholder-not-for-distribution"`. Reserve the
Stability license label for backends that actually run the model.

### L1 — low: coverage-warning hint says "snapshot with beat clip" even when the track already has a clip
**Repro:** the pad track already had a `padclip`; the warning still advised "snapshot with beat
clip, then beat scene / beat place." The only step actually needed was `beat place`. The generic
hint could send a user to re-snapshot needlessly. **Fix direction:** when the unplaced track already
has ≥1 clip, tailor the hint to "place an existing clip: beat place <scene> <track> <clip>" (it even
knows the clip id — it counted it).

### L2 — low: `source gen` success line gives no signal it ran the stub vs a real model
**Repro:** `registered kick1: sha256:… (1s, license Stability-AI-Community)` — identical shape
whether stub or (hypothetically) stableaudio. The honest "stub" signal lives only in the sidecar
`source`/`generated.backend` fields. A hurried user won't open the JSON. **Fix direction:** echo the
backend in the success line, e.g. `registered kick1 [backend: stub — placeholder tone] …`. Naturally
also addresses M1/M2 visibility.

### Polish — stub has only 12 distinct timbres (`seed % 12`) and every tone is the same steady sine+noise
Not a bug for a plumbing stub, but worth noting: seeds 0 and 12 collide, and a "kick", "hat", and
"pad" at seeds 0/1/2 are three pitches of the identical steady tone (all crest ~4.1 dB, all -6 dBFS
peak). Fine for exercising the pipeline; just don't expect a stub kit to sound like a kit. No action
needed beyond M1's visibility fix.

## What worked well

- **Degraded path is exemplary.** Default-backend failure names the pip command, `--doctor`, *and*
  `--backend stub`, identically on CLI and MCP. `--doctor` returns clean, honest JSON. This is the
  single best part of the feature.
- **The silent-render coverage warning does its job.** It fires in both `inspect` and `render`
  (before the expensive Chromium spin-up), it's content-gated so empty tracks don't nag, the message
  names the exact track and clip count, and completing the placement cleanly clears it. It caught
  exactly the "shipped silence" mistake it's meant to.
- **Provenance sidecar is structurally sound and honest at the top level** (`generated:stub`), and
  records the real per-file prompt/seed even when the audio is identical.
- **Determinism holds** (same seed+seconds → identical sha256) and is a genuine asset for
  reproducible sessions.
- **Rendering "just worked"** — bundled Chromium auto-discovered with zero config, no hang, and
  `metrics`/stems confirmed the generated sounds are actually audible in the mix.
- **CLI ↔ MCP parity** across gen, inspect (warning text), place/unplace, and error surfaces.

## Resolution (same day, Phase 39 Stream UC)

All four actionable findings were fixed the same day the pilot ran (the polish item — the stub's 12
timbres — is left as expected stub behavior):

- **M1 (stub ignored the prompt → identical output):** an unpinned `beat source gen` now derives its
  default seed from the prompt (djb2 hash in `scripts/source-lib.mjs`), so two distinct prompts
  produce distinct sounds while the same prompt still reproduces. An explicit `--seed` still pins.
  Regression-guarded in `test/gen-sidecar.test.ts`.
- **M2 (stub stamped as a Stability model output):** stub-generated media is now licensed
  `stub-placeholder` with a null `licenseUrl`; only a real `stableaudio` run carries the Stability AI
  Community License and its URL. (`scripts/source-lib.mjs`; test updated.)
- **L1 (coverage warning over-instructed):** when the orphaned track already has a saved clip, the
  hint now reads `place a clip in a scene (beat scene / beat place)` instead of telling the user to
  `beat clip` first. (`src/core/coverage.ts`; test updated.)
- **L2 (stub vs real indistinguishable in the success line):** the `beat source gen` success line now
  echoes the source (`generated:stub` vs `generated:stable-audio-open`) alongside the license, so the
  stub is visible without opening the sidecar. (`cli/beat.mjs`.)

The two features needed no correctness fixes — these are all honesty/ergonomics polish on the stub
path, verified live and covered by tests.

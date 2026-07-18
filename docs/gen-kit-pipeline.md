# The gen-kit pipeline — `beat gen-kit`

> One command that composes a playable beat entirely from generated sounds. It is the
> `examples/recipe-song/` workflow — built by hand over an afternoon on 2026-07-14 — automated on
> the Phase 40 machinery, and the direction the owner chose to double down on after finding
> fal-generated sounds more compelling than the synth engine's output ("the most interesting and
> sonically different thing we've generated thus far… all the sounds are samples").

## The command

```
beat gen-kit <project-dir>
    [--roles kick,snare,hats,perc,bass,lead]   # any subset; build order is fixed
    [--candidates 4]                           # N generated candidates per role (cap 16)
    [--bpm 96] [--key a] [--scale minorPentatonic]
    [--gen-backend fal|stub|stableaudio]       # default fal (FAL_KEY); stub = CI/deterministic
    [--seed 41]                                # the whole kit is deterministic in this
```

Output: `<project-dir>/<basename>.beat` — a **normal .beat project**. Renderable (`beat render`),
variable (`beat vary`), regen-able (`beat regen --verify`), every asset carrying an enforced
provenance sidecar. Plus one candidate batch dir per role, left behind on purpose (below).

## What it does, per role

Every step reuses an existing Phase 40 piece — gen-kit adds no new generation, analysis, or
registration machinery, only the loop:

1. **Generate N candidates as a deferred-registration batch** (`genSourceBatch`, Phase 40 VB).
   The prompts follow taste-collect's **style-contrast convention**: one subject ("a punchy kick
   drum one-shot") × N distinct style treatments from the shared `GEN_STYLES` bank ("lo-fi, dusty,
   vinyl character" …), drawn deterministically from `--seed`. N seeds of one prompt are
   near-clones and carry almost no preference signal (owner insight 2026-07-17); N styles of one
   subject span real feature-space distance. Nothing touches the `.beat` at this stage.
2. **Pick a default by a measurable heuristic**:
   - *Drum roles* (kick/snare/hats/perc): the candidate whose **spectral centroid** sits closest
     (log-distance) to the role's target band (kick ~150 Hz, snare ~1.8 kHz, hats ~6 kHz,
     perc ~2.5 kHz). This is exactly the by-hand snare pick from the recipe-song, automated.
   - *Tonal roles* (bass/lead): the candidate with the most **confident single detected pitch**
     (`detectPitch`, Phase 40 VA) — a keymap built on a wrong root is worse than none, so pitch
     confidence *is* the quality axis. If no candidate reaches medium confidence, the best one
     still wins but is rooted on its lowest strong partial (the same call `beat keymap`'s
     `--root` refusal hint makes), and the output says which path was taken.
3. **Adopt the winner alone** (`adoptVariant`): the deferred registration runs on the picked
   candidate only — media entry, sha256, enforced provenance sidecar recording the candidate's
   *own* style prompt + seed + backend. **Losers never enter the media block.**
4. **Keymap tonal winners into the project's key** (Phase 40 VA arithmetic): one octave of
   `--scale` rooted on the `--key` pitch class, anchored to the register the sample actually came
   back in (the key contributes its pitch *class*, the sample its octave — this keeps every lane
   tune well inside the ±24-semitone clamp no matter where generation landed). Fractional tunes
   are normal and correct.
5. **Write starter patterns**, seeded from `--seed`: a straightforward groove across the kit lanes
   (four-on-the-floor kick, backbeat snare, eighth hats with a seeded extra sixteenth, sparse
   offbeat perc) and simple in-key bass/lead phrases over the keymap lanes — in-key **by
   construction**, since a keymapped track's lanes *are* scale tones. This is deliberately a
   starting point for `beat vary`, not a composer.
6. **Scene-place everything**: clips are snapshotted (`groove`/`bline`/`mel`), one scene `main`
   holds a slot per track, and the song plays it for 8 bars. Song mode renders only scene-placed
   content — the Phase 39 silent-render trap — so gen-kit never leaves a populated track
   unplaced (`unplacedContentTracks` is asserted empty in its tests).

## How it feeds the taste loop

Each role's candidates land as an **ordinary rateable batch dir** — the one D21 manifest shape,
group **`genkit:<role>`**, wavs already present (no render needed) — so a gen-kit run is also a
data-collection run:

- `beat rate <project-dir>` queues every role batch for blind ranking; picks land in the same
  `beat-scores.jsonl` as vary batches, with the prompt recorded per entry.
- `beat score <batch-dir> …` / `beat adopt <batch-dir> vN --force` re-picks a role by hand
  (`--force` because the project has legitimately moved on since the batch was written — the
  adopt message explains exactly this case).
- `beat taste-eval` classifies `genkit:*` groups as **gen rounds** (`variantTypeOf`), same as
  `gen:*`, so its per-type ablation splits see gen-kit data as generation preference data.

**What the critic will eventually re-pick.** The centroid/pitch heuristics are placeholders for
taste, and honestly labeled as such: they guarantee a *plausible* first render (a kick that is
actually low, a bass with an actual root), not a *good* one. The T4/T5 trajectory
(docs/taste-loop-design.md) is that the trained taste model replaces step 2 — scoring each role's
candidate batch with `beat suggest --taste` and picking its top-ranked candidate instead of the
centroid rule, with the heuristic demoted to tie-breaker/sanity floor (a taste model must not pick
a 6 kHz "kick" either). Because all candidates stay behind as scoreable batches, every gen-kit run
generates exactly the training data that upgrade needs.

## Determinism and the recipe property

With a given backend, the whole kit is a pure function of the flags: same `--seed` ⇒ same style
prompts, same generation seeds, same picks, same patterns ⇒ **byte-identical `.beat`** (asserted
in `test/genkit.test.ts` for the stub backend). Every registered sample's sidecar carries its full
generation recipe, so `beat regen <file> --verify` reproduces all of `media/` from text alone —
sha-exact on the stub backend and same-machine/same-torch for the real ones (regen's honest
scoping). The project *is* a recipe.

`--gen-backend stub` runs the entire pipeline with zero Python packages (a deterministic stdlib
tone bed) — it is what CI and the tests use, and what proved the plumbing here. Real kits are
fal-side (`FAL_KEY`, seconds and cents per one-shot) or local stableaudio (owner venv, ~2 min per
one-shot on CPU).

## Current scope / known gaps

- CLI-only for now — no `beat_gen_kit` MCP twin yet (the loop is `beat gen-kit` + the existing
  `beat_score`/`beat_adopt` tools for re-picking). Add the twin when the command's surface settles.
- Roles are the fixed six. Pads/textures/vox (already in taste-collect's subject bank) are the
  obvious next roles; a pad wants an audio-region clip (the recipe-song's repitched pad bed), not
  a lane.
- Starter patterns are two bars, one scene, one section. `beat vary … feel`, `beat song`, and the
  arrangement verbs are the intended next moves — gen-kit hands over a playable sketch, not a song.

## Pointers

- `src/analysis/genkit.ts` — the pure half: role specs, style prompts, pick heuristics, keymap
  span, seeded pattern plans (all unit-tested without audio).
- `cli/beat.mjs` `genKitCmd` — the loop: genSourceBatch → measure → adopt → build document.
- `test/genkit.test.ts` — pure tests + the full stub pipeline (project shape, deferred
  registration, scene coverage, determinism, `regen --verify`).
- `examples/recipe-song/` — the hand-built original this automates; `docs/phase-40-plan.md` — the
  pieces; `docs/taste-loop-design.md` — where the critic comes from.

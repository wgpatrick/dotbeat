# Composing produced (`add-track --produced` / `beat produce`)

*The authoring face of the produced-defaults layer. For the layer itself and its research grounding,
see `src/analysis/produce.ts` and `docs/research/115-production-layer-techniques.md`; for the named
single-move catalog above it, `docs/tricks.md`.*

## Why this exists

The blind source-showdown found dotbeat's synth loses to commercial chops on production
**richness**, not cleanliness — mono output (stereo width ≈ -52 dB vs ≈ -11 dB for real records),
near-zero air-band energy, the lowest production-complexity scores. An ablation that added **only**
production edits — same notes, same patch — moved the engine from 3% to 29% of blind pairwise wins
(63% on lead). `src/analysis/produce.ts` turned that ablation into a shared, role-aware layer.

But until now that layer only fired in two places: `beat gen-kit` (whole generated projects) and the
taste seeds. An **ordinary `beat add-track`** still handed you the canonical dry / mono / static init
patch — the exact loss mode the showdown measured. "engineplus" was an eval arm, not something you
could compose with. These two commands close that gap: they make the production layer a first-class
**authoring** move, so a track you build by hand can ship produced the same way a generated one does.

## The two commands

```
beat add-track <file> <id> <kind> --produced [--role bass|lead|pad|keys|drums]
beat produce   <file> <track>     [--role bass|lead|pad|keys|drums] [--dry-run]
```

- **`add-track --produced`** creates the track, then applies its role's production profile the moment
  it exists — you get a produced track in one step instead of `add-track` followed by a pile of
  `set`s. Everything the plain `add-track` does (default effect chain, 12-lane drum kit, `--name` /
  `--color`) still happens first.
- **`beat produce`** is the retrofit: *"make this existing track engineplus."* Point it at a track
  that generation or hand-editing left dry and it applies the same profile. `--dry-run` prints the
  diff without writing.

Both print an **honest applied list** in the `beat trick apply` house style — an entry per field that
actually changed, so the receipt never claims a move it didn't make.

## Roles and how they're picked

The profile is chosen by **production role**, not track kind. The role is inferred from the track id
via the same `productionRoleFor` synonym table gen-kit uses (`bass`/`sub`, `lead`/`arp`/`melody`/
`pluck`, `pad`, `chords`/`keys`/`stab`, `kick`, `snare`/`clap`, `hats`/`hihat`, `perc`/`tom`,
`kit`/`drums`). Pass `--role` to override — the user-facing aliases map through the same table, so
`--role keys` resolves to the chords profile and `--role drums` to the kit bus. The resolved role is
echoed in the receipt (`produced bass (role: bass): …`) so the mapping is always visible.

An un-inferrable **drums** id (one that would otherwise fall to the mild all-round `default`) resolves
to the **kit-bus** profile instead — a drums track's bus carries the kick, so it wants the bus
treatment, not the generic one.

What each role gets (grounded in research 115 P1 width / P2 air / P3 motion):

| role | width | air | glue | space | motion |
|---|---|---|---|---|---|
| **lead** | osc2 detune layer + unison + chorus + utility | shelf | saturation | reverb + delay sends | — |
| **pad / chords (keys)** | widest unison + chorus + utility + noise wash | shelf | saturation | most reverb | — |
| **bass / sub** | **none** (mono-anchored, §2.2) | — | saturation | **no reverb** | sidechain duck under the kick |
| **kit (drum bus)** | **none** (carries the kick) | shelf | light glue | — | — |
| **hats / perc** (standalone) | — | shelf | — | reverb | auto-pan |
| **kick / snare** | — | snare shelf | saturation | snare a touch of reverb | — |

The **bass/sub sidechain duck** is the one move a base profile can't set itself — it needs a source
track id. Both commands wire it automatically when a kick-carrying drums track already exists in the
project (pointing the duck at it), the genre-defining pump from §4.2. If there's no kit yet, the duck
is simply skipped (it never points at a phantom source); add the bass after the kit, or re-run
`beat produce` on the bass once the kit is in.

## Two invariants make it safe

Both properties are inherited straight from `applyProducedDefaults` — the commands add no new values:

1. **Intensify-only.** Every numeric move is a `Math.max` against the patch's own current value. A
   track that already carries richer production **keeps** it; the moves never quiet anything. So
   `beat produce` is safe to run repeatedly — a second pass on an already-produced track is a no-op
   (`nothing to intensify — the patch already meets this profile`), and it will never undo hand-tuning
   you did between passes.
2. **Deterministic.** The profile is a pure function of role — no rng. The same command on the same
   track produces byte-identical output.

## What it will not do

- **Non-voiced kinds.** `instrument` and `audio` tracks carry no synth patch / drum bus for the layer
  to act on; both commands refuse them with a clear message rather than writing nothing.
- **Synth-only moves on drum/sample voices.** The osc-bank width stack (osc2 / unison / noise) and the
  reorderable-chain inserts (utility, auto-pan) apply to **synth** voices only — a drum/sample voice
  doesn't read them, so claiming them there would be dishonest. A produced drums track's width comes
  from the chorus insert and the stereo reverb bus instead, and the receipt reflects exactly that.

## Where this sits in the ladder

`beat produce` applies the **whole role profile** (the produced-defaults baseline). `beat trick apply`
pulls **one named move** from the catalog above it, with preconditions and a declared metric delta.
`beat gen-kit` builds a whole produced project from generated sounds. All three, plus the taste seeds,
route through the single `src/analysis/produce.ts` primitive — the production **values** live in
exactly one place.

```
beat add-track … --produced   compose a NEW track already produced
beat produce                  retrofit an EXISTING track (intensify-only)
beat trick apply              pull ONE named move (docs/tricks.md)
beat gen-kit                  generate a whole produced project
```

## MCP

Both surfaces have MCP twins: `beat_add_track` takes `produced: true` (and optional `produced_role`),
and `beat_produce` is the retrofit tool — same semantics, same receipts.

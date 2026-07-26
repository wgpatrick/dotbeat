# Mined production priors

Raw research notes from the 2026-07-26 prior-mining fleet (nine parallel agents, one narrow vein
each), captured to answer the owner's strategic frame: the synth/layer/FX parameter space is too
large to search blindly with metrics we don't fully trust, so work from human priors instead —
"pick up tricks/rules/ideas from internet sources... build a set of things that work."

These are NOTES, not the product. They are the input to the executable recipe library specified in
`docs/research/139-recipe-library-and-layering.md` §4, whose schema turns a recipe into something an
agent can both execute and VERIFY (measured gates from `docs/research/131`'s discriminators).

| file | vein | recipes |
|---|---|---|
| `bass-house.md` | house / tech-house / deep-house bass | 10 |
| `bass-techno.md` | techno / melodic techno / acid | 18 |
| `bass-basseries.md` | DnB / dubstep / trap, Reese + 808 | 15 |
| `chords-pads.md` | stabs, pads, plucks | 13 |
| `leads.md` | supersaw, distorted mono, hooks | 12 |
| `drums.md` | kick/clap/hat design + drum bus | 12 |
| `layering.md` | per-role layer architectures | the structural vein |
| `transients.md` | punch, compression, transient design | technique vein |
| `pack-production.md` | how commercial loops are made to ship | standards vein |

Each file marks cross-source CONSENSUS (implement first) separately from CONTRADICTIONS (style
dials, not physics — e.g. "classic" Reese detune spans ±7 to ±61 cents across sources). Claims carry
source URLs. Where a technique needs a parameter dotbeat cannot express, the file says so.

Companion: `docs/research/141-preset-parameter-ground-truth.md` mined the same questions from 3,559
Surge patch FILES rather than prose — use it wherever the two disagree, since it measures what
designers did rather than what tutorials say.

// The `figureSource` split — RE-EXPORT BARREL. The implementation now lives in src/taste/showdown.ts,
// beside the rest of the showdown scoreboard.
//
// History, kept because it is the point of the finding (audit 140 D7, from research 124 §B.7/§C.7 and
// 125 §4 — both docs' CENTRAL validation experiment): `figureSource` records where a showdown batch's
// COMPOSED figures came from ('midi' / 'theory' / 'ca2' / 'bank'). It was written into the batch
// manifest and copied into the scores-log entry — and then nothing read it. `computeShowdownReport`
// tallied overall / by role / by ref-pool and no fourth axis, so the theory layer (1,294 lines) and
// the CA2 sidecar (a 716 MB out-of-repo model, a Python sidecar, guards, tests, a doctor) both
// shipped specifically to be measured by an experiment whose readout did not exist.
//
// WHY IT WAS MISSED (worth keeping, because it generalizes): `figureSource` was built as PROVENANCE
// — D25 licensing hygiene, "the shared log records only the kind, never a song title or path" — and
// the privacy framing masked that the same field is also the experimental factor.
//
// It shipped HERE first only because src/taste/showdown.ts was being actively edited by another
// stream at the time; this file's header named the integration point and the trigger ("when
// showdown.ts is free"). That stream merged 2026-07-25, the trigger fired, and
// `computeShowdownReport` / `formatShowdownReport` now carry the split for real. The barrel stays so
// every existing import path — and this module's own test file — keeps working with no edit.

export {
  FIGURE_SOURCES,
  UNLABELLED,
  figureSourceByBatch,
  figureSourceSplit,
  formatFigureSourceSplit,
  type FigureSource,
  type FigureSourceGroup,
  type FigureSourceSplit,
} from './showdown.js'

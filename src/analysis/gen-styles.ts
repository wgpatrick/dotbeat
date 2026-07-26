// The generation-prompt STYLE bank, and the one-subject-in-n-styles prompt builder over it.
//
// This lives DAW-side (src/analysis, alongside gen.ts/gen-fal.ts/genkit.ts) rather than in
// src/taste/seeds.ts, where it started, because of the import-boundary rule research/136 named its
// top pick: **the DAW may not import the taste program** (enforced by test/import-boundary.test.ts).
// `src/analysis/genkit.ts` needs `stylePromptsFor` so a `beat gen-kit` batch speaks the SAME prompt
// vocabulary the taste loop collects and scores; that need pointed the wrong way across the
// boundary. The bank has no taste-model dependency at all — it is strings plus a seeded shuffle —
// so the fix is to own it on the DAW side and let `src/taste/seeds.ts` import it back (taste may
// import the DAW; the DAW may not import taste).
//
// `seeds.ts` still re-exports the bank as `genStyles()`, which is the accessor showdown and
// taste-collect read: showdown styles ARE taste-collect styles, and that stays true.

import { seededShuffle, mulberry32 } from '../core/rng.js'

/** The 8 production-texture treatments layered on TOP of whichever subject is being generated.
 * Snapshot-tested in test/prompt-bank.test.ts — changing this bank changes every prompt any
 * historical batch would be regenerated from, so treat it as vocabulary, not as tuning. */
export const GEN_STYLES = [
  'analog warmth, tape saturation',
  'clean and modern, club-ready',
  'lo-fi, dusty, vinyl character',
  'dark and cavernous, heavy reverb',
  'bright and glassy, digital sheen',
  'organic and acoustic-leaning',
  'gritty distorted electronic',
  'soft, intimate, close-mic feel',
] as const

/** ONE subject in `n` DISTINCT styles — the per-candidate prompt convention taste-collect's
 * style-contrast batches use (owner insight 2026-07-17: N seeds of one prompt are near-clones;
 * N style treatments of one subject span real feature-space distance). Styles are sampled without
 * replacement from the shared bank, cycling only if `n` exceeds the bank. Deterministic in `seed`. */
export function stylePromptsFor(subject: string, n: number, seed: number): string[] {
  const rng = mulberry32(seed)
  const shuffled = seededShuffle(rng, GEN_STYLES)
  const prompts: string[] = []
  for (let i = 0; i < n; i++) prompts.push(`${subject}, ${shuffled[i % shuffled.length]!}`)
  return prompts
}

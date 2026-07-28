// Which capture path a render takes — offline compute (D22/D23) or real-time capture — decided
// ONCE, here, for every surface that offers the choice.
//
// Three surfaces now ask the same question: `beat render` (offline only on request), `beat render
// --batch` (offline by default — a vary batch is short clips, exactly where offline is both exact
// and fast), and `beat feedback` (added 2026-07-27). Before this file, the first two each carried
// their own copy of the same three rules — `--offline`/`--live` are mutually exclusive, an
// offline-refusing project is a hard error when offline was ASKED for but a silent fallback when
// it was merely the default, and the chosen mode is announced rather than assumed. A third copy in
// `feedbackCmd` would have been the seventh measured instance of the copy-a-handler-and-vow-to-
// keep-it-in-sync failure CLAUDE.md's parity rule exists to stop, so the decision lives here and
// the surfaces keep only their own I/O (the same split `src/vary/run.ts` uses: pure decision here,
// printing there).
//
// This module is deliberately PURE — no fs, no browser, no parse. The offline REFUSAL (soundfont
// tracks / sf-backed lanes need a native realtime worklet context) is computed by the caller from
// the parsed doc and handed in, so every branch below is unit-testable without booting anything.

/** The two capture paths. `offline` computes the mix through an OfflineAudioContext (exact,
 * reproducible run-to-run); `live` captures the real-time clock through MediaRecorder. */
export type CaptureMode = 'offline' | 'live'

/** What a surface does when the user passed NEITHER `--offline` nor `--live`.
 *  - `'live'`: `beat render` — a single render stays on the path it has always taken.
 *  - `'offline'`: `beat render --batch` — offline whenever the project allows it, live otherwise.
 * There is deliberately no length-triggered third option; see LONG_PROJECT_SECONDS. */
export type CaptureDefault = 'live' | 'offline'

export interface CaptureModeRequest {
  /** `--offline` was passed. */
  offline?: boolean
  /** `--live` was passed. */
  live?: boolean
  /** `null` when the project is offline-eligible, otherwise the reason it is not (from
   * `offlinePreflightRefusal` in cli/render.mjs — instrument tracks or sf-backed drum lanes). */
  refusal: string | null
  /** What this surface does when neither flag was passed. */
  fallback: CaptureDefault
}

export interface CaptureModeDecision {
  /** The path to take — only meaningful when `error` is null. */
  mode: CaptureMode
  /** Why this mode: `'explicit'` a flag asked for it; `'default'` the surface's own default;
   * `'refused'` offline was the default but the project cannot take it (see `refusal`). */
  reason: 'explicit' | 'default' | 'refused'
  /** The refusal text when `reason` is `'refused'` or `error` is set; null otherwise. */
  refusal: string | null
  /** Non-null means REFUSE: the surface prints `error: <this>` and exits 2 without rendering.
   * Set for the two flag conflicts and for `--offline` against a project offline cannot render. */
  error: string | null
}

/** Songs at or above this get an advisory line pointing at `--offline`, and NOTHING else.
 *
 * The 2026-07-27 roadmap row that prompted `beat feedback --offline` suggested defaulting offline
 * for songs over ~2 minutes. Both paths were then measured end to end on the 5:22 nine-section song
 * that motivated it (songs/twin-souls-study/original.beat, 322.56s, five synth/drums tracks):
 *
 *     live capture   345.1s wall clock   arc check PASS, 9/9 sections within 2.3 LU
 *     offline        250.3s wall clock   arc check PASS, 9/9 sections within 2.3 LU
 *                    (229.9s of compute for 322.6s of audio = 1.4x realtime)
 *
 * So offline was the faster path HERE, by 95s — and the length-based default is still the wrong
 * call, for two reasons that survive that number:
 *
 *  1. Length does not predict the ratio. The same repo measured examples/first-light at 0.31x
 *     realtime after D23 (and 0.12x before it) — i.e. 3x SLOWER than live — because offline compute
 *     scales with length x DENSITY, not length (Tone schedules the whole song and renders it in one
 *     pass; see ui/src/audio/offline.ts). 1.4x here and 0.31x there is a 4.5x spread with no
 *     length-shaped rule between them, and a default that can triple the gate's wall clock also
 *     widens the window in which a sleeping machine kills it — the exact failure the row was
 *     filed about. `beat render --offline` prints the measured ratio for this reason.
 *  2. The two paths do not measure identically, and a threshold gate must not quietly re-pick its
 *     own instrument. On the same song the arc verdict agreed to within 0.2 LU per section (the
 *     relative-loudness shape is robust), but the STATIC per-section numbers a whole-mix `--ref`
 *     profile critiques did not: stereo width on the near-mono intro/outro read -25.8/-25.8 dB live
 *     versus -33.9/-30.4 dB offline, spectral centroid ran ~2-3% lower offline throughout, and
 *     crest sat 0-0.9 dB lower offline. Those are the live capture chain's own lossiness, already
 *     documented as D22's two known parity exceptions. A length-triggered default would mean two
 *     songs either side of 2 minutes are measured through different chains, and one song crossing
 *     it (add a section, cut a section) silently changes chains mid-project.
 *
 * So the length signal is spent on a HINT rather than a switch: the operator is told the flag
 * exists, at the moment it is worth having, and picks — and whichever they pick, they keep. 120s is
 * the row's own "~2 minutes". */
export const LONG_PROJECT_SECONDS = 120

/** Decide the capture path. Pure: every input is passed in, the only output is the decision. */
export function resolveCaptureMode(req: CaptureModeRequest): CaptureModeDecision {
  if (req.offline && req.live) {
    return { mode: 'live', reason: 'explicit', refusal: null, error: '--offline and --live are mutually exclusive' }
  }
  if (req.offline) {
    // Asked for explicitly => a refusal is a hard error, never a silent downgrade to the
    // non-exact path (pilot 109's headline: the one flag whose entire point is exactness is the
    // one that must never be quietly dropped).
    if (req.refusal !== null) {
      return { mode: 'live', reason: 'explicit', refusal: req.refusal, error: `offline render refused: ${req.refusal}` }
    }
    return { mode: 'offline', reason: 'explicit', refusal: null, error: null }
  }
  if (req.live) return { mode: 'live', reason: 'explicit', refusal: null, error: null }
  if (req.fallback === 'offline') {
    if (req.refusal !== null) return { mode: 'live', reason: 'refused', refusal: req.refusal, error: null }
    return { mode: 'offline', reason: 'default', refusal: null, error: null }
  }
  return { mode: 'live', reason: 'default', refusal: null, error: null }
}

/** The advisory line for a long project about to be captured in real time — or null when there is
 * nothing worth saying (short project, or already going offline). `seconds` is the render length.
 * Printing is the surface's job; the wording is owned here so both surfaces say the same thing. */
export function longProjectOfflineHint(seconds: number, decision: CaptureModeDecision): string | null {
  if (decision.mode !== 'live' || decision.error !== null) return null
  if (decision.reason === 'explicit') return null // they asked for live; don't second-guess it
  if (seconds < LONG_PROJECT_SECONDS) return null
  if (decision.reason === 'refused') return null // offline is not available at all — see the refusal line
  // Floor, not round: rounding both prints 5:23 for a 5:22.56 song (off by one from every other
  // duration the tool shows) and can produce a literal "1:60" at 119.7s.
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds - mins * 60)
  return (
    `note: this is a ${mins}:${String(secs).padStart(2, '0')} project and real-time capture holds a headless browser open for all of it ` +
    `(it dies if the machine sleeps). --offline computes the same mix through an offline context instead — exact and ` +
    `reproducible, though not always faster on a long project.`
  )
}

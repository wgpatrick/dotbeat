# 108 — Usability pilot: the blind taste-rating loop (CLI)

*Run 2026-07-16, immediately after T0 of the taste-loop program landed (docs/taste-loop-design.md;
`beat taste-eval`, `beat audition`, shuffled `--audition`, score-log feature enrichment). Musician
persona, CLI-only, goal-driven per docs/usability-testing.md's CLI-pilot variant: "generate a few
variant batches and rate them the blind way, check what the taste evaluation says about me, and
rate a folder of existing wavs." ~25 tool calls.*

## Verdict

A terminal-comfortable musician ran the whole loop unaided and called it "genuinely pleasant once
inside": every command printed the exact next command (vary → score → adopt/suggest), the
plain-wav-folder path worked first try into the same taste log, and `taste-eval` was honest about
small samples while showing taste directions that visibly responded to picks. All friction was at
the edges: getting INTO the loop, and one real data-integrity trap.

## Findings and same-day dispositions

1. **MEDIUM — contradictory re-scores silently accepted and counted as extra eval folds.**
   Re-scoring an already-scored batch appended a contradicting entry with no warning, and
   `taste-eval` reported 5 "usable batches" from 4 real ones. **FIXED same-day**: `beat score`
   now prints the previous ranking when a batch is re-scored ("the log keeps both, and beat
   taste-eval uses only the LATEST entry per batch"), and the harness dedupes to the latest entry
   per batch dir, reporting how many earlier re-scores were superseded. The log stays append-only
   (a re-score is a legitimate change of mind — the semantics changed from "another data point"
   to "supersedes").
2. **MEDIUM — the help dump is a ~350-line wall and per-command help was undiscoverable.**
   `beat help <cmd>` / `beat <cmd> --help` have existed since Phase 34 — the pilot grepped the
   wall anyway, because nothing advertised them. **FIXED same-day**: the dump header now reads
   "usage (one command's block: beat help <command>, or beat <command> --help):", and the
   vary/score family was extended to the full taste loop (vary, audition, score, adopt, suggest,
   taste-eval) so each command's "related:" line teaches the loop.
3. **MEDIUM — `beat init` leaves a silent project with no on-ramp.** A first `vary --render` on a
   fresh project would burn real-time renders on silence. **FIXED same-day**: init now prints the
   add-sound then:-hint (add-note, or add-track + drum-kit), matching the hint convention
   everywhere else.
4. **LOW — the "blind" audition printed the answer key** (variant-at-timecode map) on the same
   line as the wav path. **FIXED same-day**: a shuffled audition's printed index withholds the
   mapping ("listen and rank BEFORE looking at the answer key in audition.json"); unshuffled
   auditions keep the classic timecode index. audition.json also records `shuffled`.
5. **LOW — render output leaks engine internals** (daemon ports, Chromium fallback lines, Tone.js
   deprecation warnings) into a musician-facing flow. NOT fixed here: the passthrough is
   deliberate (it carries real sample-load failures — the 2026-07-13 dogfood lesson), so a fix
   must filter known-benign lines rather than silence stderr. Left for a fix phase.
6. **LOW — user-facing output cites repo-internal docs** (`taste-eval`'s note cites
   docs/research/107; suggest cites a .ts module doc). Deliberate for now — dotbeat's primary
   users today live in the repo — but worth revisiting the day the CLI ships beyond it.
7. **LOW (positive) — error handling held up**: bad picks give exact actionable errors (exit 2);
   clip-set scoring routes to the shared log and explains why adopt refuses.

## Pattern note (for the pilot series)

Same lesson as pilots 94-106: the scripted tests all passed while a first-session user immediately
manufactured the one state transition nobody asserted (score the same batch twice). The
data-integrity class of finding — "the tool accepted input that quietly degrades a downstream
consumer" — is invisible to per-command tests and cheap to catch with a goal-driven pilot the same
day the surface ships.

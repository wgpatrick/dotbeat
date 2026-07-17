# Usability pilot 112 — taste data-collection pipeline (`taste-seeds` / `taste-collect` / `rate`)

**Goal:** Persona: the owner sitting down for his first real taste-data session. Knows the pitch
("generate seed songs, collect batches, rate them in a browser, the model learns your taste") but
has never run any of these three commands — everything discovered from `beat help`. Target: end the
session with at least 4 rated batches in a scores log and a `taste-eval` readout over them. No
FAL_KEY in the environment (deliberately: judge the default fal path's failure cold, the way a
first-time user would hit it). No browser available, so `beat rate`'s HTTP API was driven with curl
exactly as its own page does (GET `/api/queue`, GET `/audio?b=..&f=..`, POST `/api/score`), and the
served HTML was read critically as a UI review. No source reading at any point — CLI output, served
assets, and on-disk artifacts only.

## Narrative walkthrough

**Discovery.** `beat help` is now 43.7KB — I had to grep my own scrollback to find the taste block.
Once found, though, the block is genuinely complete: `taste-seeds` says "Step 1 of the
collect->rate->eval pipeline", `taste-collect` explains `--per-seed` and `--gen`, `rate` explains
blind shuffle, resume, and the ONE-log design, and even prints the eval command you'll want after.
One real gap: `taste-collect [--count 5]` is listed but the prose never says what `--count` counts.
(I learned it by accident two commands later: it's variants per batch — my `--count 3` run made
3-variant vary batches; a later run without it made 5-variant gen batches.)

**Seeds.** `beat taste-seeds ./taste --count 3` → three one-line descriptions ("i-iv-VI-v in minor @
90bpm, break drums, arp") and a `next: beat taste-collect ./taste` pointer. `beat inspect` on
seed-001 confirms a real 4-track project (chords/bass/arp/drums, populated default effect chains).
Small aside: seed drums use the "implicit legacy 5-lane kit" while the help's own `add-track` blurb
brags that fresh drums default to the 12-lane kit — presumably deliberate for vary-space reasons,
but it reads inconsistent.

**Collect, hitting fal cold.** `beat taste-collect ./taste --per-seed 1 --count 3 --gen 1` (default
backend). The three vary batches rendered offline through the headless harness in ~1 minute total,
each with the now-familiar mode banner and per-variant compute ratios. Then the gen batch:

```
error: the fal backend needs an API key: export FAL_KEY=... (create one at
https://fal.ai/dashboard/keys). Local alternative: --backend stableaudio (owner-side venv) or --backend stub
warning: gen "riser1" failed — skipping (Command failed: ... source gen ... --backend fal) — FAL_KEY set and fal.run reachable?
```

Judged cold: the first line is excellent — what's missing, where to get it, two local alternatives.
But it names the *inner* command's flags. I did what any user would — copied `--backend stub` onto
my next `taste-collect` — and got `error: unknown flag "--backend" (known: --per-seed, --count,
--seed, --gen, --gen-backend)`. Recovery took one step because the unknown-flag error lists the real
flags (good strict parsing), but the CLI literally handed me a flag its own command rejects. The
follow-up warning also second-guesses its own error ("FAL_KEY set and fal.run reachable?" — no, you
just told me definitively it isn't set) and leaks the internal `node .../beat.mjs source gen ...`
invocation. The summary line, though, is exactly right: "3 vary batch(es) + 0 gen batch(es) across 3
seed song(s) (1 failed)" plus the next two commands.

The failed gen also left `taste/gen-riser1-91418/` behind as an **empty directory**. Everything
downstream tolerated it (excluded from the rate queue, ignored by eval), so it's litter rather than
breakage — but a session with several fal failures would accumulate a graveyard of empty batch dirs
indistinguishable at `ls` level from real ones.

`taste-collect ./taste --per-seed 0 --gen 2 --gen-backend stub` then produced two gen batches
instantly (riser + kick one-shots, 5 variants each — the accidental `--count` lesson).

**Rating over HTTP.** `beat rate ./taste --port 4517` prints the three things you need: unscored
count, the log path, and "open http://localhost:4517 — ctrl-c here when done". `/api/queue` returned
all 5 real batches (empty dir correctly absent) with human labels ("arp feel (seed 50884)",
'generated: "a punchy kick drum one-shot..."') and a genuinely shuffled per-batch order. Audio
serves as `audio/wav`; a path-traversal filename (`f=../../rate-page.html`) 404s.

Read as a UI review, the page is small and good: blind letters with the *reason* stated in the hint
("letters are shuffled per batch, so listen, don't pattern-match"), keyboard map (1-9 pick, enter
save, s skip), pick-order ranking with best/2nd/3rd badges and colored borders, clear + skip
buttons, "batch N of M" progress, and a charming done state. Dents: "save ranking" with zero picks
is a **silent no-op** (the code returns without any feedback — a user who thinks they picked will
click and wonder); there's no back/undo after a mis-skip or accidental enter; and skip is
session-local (batch reappears next run — correct behavior, but nothing says so).

Scored 4 batches by POSTing picks exactly as the page does; every response `{"ok":true,"log":...}`.
Ground truth held up completely: `beat-scores.jsonl` gained 4 entries each carrying batch path,
`group` ("gen:kick1" / vary group), the gen prompt, ranked picks with media sha256s, the explicit
`rejected` list, and full per-variant DSP features (LUFS, peaks, crest, band %, centroid, stereo) —
everything eval needs, written at score time. And `/api/queue` **recomputes live**: immediately
after scoring, the queue showed only the one unrated batch, without a server restart. Re-running
`beat rate` on the fully-scored dir later reported "0 unscored batch(es)" — resume semantics are
real.

**Mistaken paths.** POST bogus pick → `pick "v9" is not a variant number 1-3 (accepts "N" or "vN")`;
bogus batch id → `no such batch directory or missing manifest.json: ...`; empty picks → `score
needs 1-3 ranked picks (variant numbers, best first)`. All clear, human, specific — though all
returned HTTP 500 where these are 400-class client errors, and the message describes picks as
variant *numbers* while the page itself posts `vN.wav` file names (which the API also accepts —
three spellings in practice, two documented). None of the bad POSTs corrupted the log.

`beat rate ./empty-dir` doesn't error — it starts the server anyway: "rating 0 unscored batch(es)"
then waits, and the browser would show "all 0 batches rated — thank you, the taste model appreciates
it." A user who pointed at the wrong dir gets thanked instead of told to run `taste-collect`. Worse:
`beat rate ./taste --prot 4520` (typo'd `--port`) was **silently accepted** — the server bound the
default 4321 while I sat waiting on 4520. `taste-collect` rejects unknown flags with a helpful list;
`rate` swallows them — the exact lax-parsing class pilots 109/111 flagged on `render`/`vary`,
recurring on a brand-new command. Also self-inflicted but worth noting: starting `rate` on an
already-bound port dies with a raw Node `EADDRINUSE` stack trace, no friendly "port in use — pass
--port" line. On the good side, `beat taste-seeds` with no args is exemplary: one usage line, exit 2.

**Eval.** `beat taste-eval --log taste/beat-scores.jsonl --embed-backend stub --aes-backend stub`
(4s): "usable batches: 5 (5 with stored features, 0 lazily derived)", six scorers with top-1/top-3/
pairwise vs chance, **per-type gen/vary splits present and every one honestly tagged "[small split —
smoke, not evidence]"**, signed DSP taste directions, named CE/CU/PC/PQ aesthetic directions, and a
closing note citing research/107's 10-30-batch expectation. As a first-session readout this is
exactly the right posture — the numbers are noise at n=5 (random beat every model on top-1) and the
harness says so itself, repeatedly, instead of letting me over-read. Two cosmetic nits: `top-3 100%
(chance 100%)` rows for 3-variant batches are tautologies the readout still prints, and six scorers
x three splits is a wall for a first-timer (a one-line "best scorer" verdict would help).

Goal met in full: 5 rated batches (3 vary + 2 gen) in one log, eval readout with per-type splits.

## Findings summary

- **[worked well] HIGH — the pipeline is genuinely self-guiding end-to-end, and its ground truth is
  airtight.** Every stage prints the literal next command (seeds → collect → rate → eval); the
  scores log carries ranks, rejected variants, media sha256s, gen prompts, and per-variant DSP
  features at score time; `/api/queue` recomputes live so scored batches vanish without a restart;
  re-running `rate` resumes correctly; the audio endpoint blocks path traversal. A first-timer can
  complete the whole loop from `beat help` alone — I did.
- **[bug] MEDIUM — `beat rate` silently ignores unknown flags.** `beat rate ./taste --prot 4520`
  starts the server on default 4321 with no warning; the user waits on a dead port. Inconsistent
  with `taste-collect`, which rejects unknown flags listing the known set — the same lax-parsing
  class pilots 109/111 flagged on `render`/`vary`, now recurring on a new command. Suggest one
  shared strict-flags helper. CLI-specific (`cli/beat.mjs` rate arg parsing).
- **[confusing] MEDIUM — the fal-missing-key error hands `taste-collect` users a flag that
  `taste-collect` rejects.** The (otherwise excellent) error says "Local alternative: --backend
  stableaudio ... or --backend stub", but those are `source gen`'s flags; copied onto the command
  the user actually ran, `--backend` errors as unknown (`taste-collect`'s spelling is
  `--gen-backend`). The trailing warning also contradicts the error ("FAL_KEY set and fal.run
  reachable?" right after "needs an API key") and leaks the internal `source gen` invocation.
  Everyone without FAL_KEY hits this on their first collect. CLI-specific.
- **[confusing] MEDIUM — `taste-collect`'s `--count` is undocumented in its own help block.**
  `--per-seed` and `--gen` are explained; `--count` (variants per batch, default 5) is only
  discoverable by experiment. CLI-specific (help text).
- **[bug] LOW-MEDIUM — a failed gen batch leaves an empty batch directory behind**
  (`taste/gen-riser1-91418/` here). Queue and eval both tolerate it, so it's litter, not breakage —
  but repeated fal failures would strew empty dirs that `ls` can't distinguish from real batches.
  Delete the dir on gen failure. CLI-specific.
- **[confusing] LOW-MEDIUM — `beat rate` on a dir with no batches starts the server anyway.**
  "rating 0 unscored batch(es)" then a browser page saying "all 0 batches rated — thank you." When
  the dir has no batch dirs at all (vs. all-scored, where the message is fair), exit with a pointer
  to `beat taste-collect` instead. CLI-specific.
- **[confusing] LOW — rate page: "save ranking" with zero picks is a silent no-op** (no shake, no
  message), and there's no back/undo after a mis-skip or accidental enter — one stray keypress on
  the wrong batch is unrecoverable within the session (the entry is already logged). UI-specific
  (the inline page in the rate command).
- **[confusing] LOW — score API returns HTTP 500 for client mistakes** (bogus pick, empty picks,
  unknown batch) with otherwise excellent message text; and the pick-format message speaks of
  "variant numbers 1-3 (accepts N or vN)" while the page itself posts `vN.wav` names, which the API
  also accepts — three spellings in practice, two documented. Cosmetic; nothing corrupted the log.
- **[confusing] LOW — port-in-use dies as a raw `EADDRINUSE` Node stack trace** instead of "port
  4517 in use — pass --port". CLI-specific.
- **[worked well] MEDIUM — the eval readout's epistemic honesty.** Per-type gen/vary splits appear
  automatically for a mixed log, every under-5-batch split is tagged "smoke, not evidence", and the
  closing note cites the research base's sample-size expectations — the harness actively prevents
  over-reading a small first session. Nits: tautological `top-3 100% (chance 100%)` rows on
  3-variant batches; six scorers × three splits with no one-line verdict is dense for a first read.
- **[slow-to-discover] LOW — `beat help` is 43.7KB**; finding the taste block means scrolling or
  grepping. `beat help <command>` exists (the usage header says so), which mitigates — but a
  first-timer doesn't know the command names yet. Also noted in passing: taste seeds build their
  drums as the legacy implicit 5-lane kit while help says fresh drums default to 12 lanes —
  presumably intentional (smaller vary space), worth a word somewhere.

## Where the pilot gave up on the "ideal" workflow

Nowhere — the stated goal was reached fully through the intended path. The only forced substitution
was environmental: no browser meant driving `rate`'s HTTP API with curl instead of clicking, which
if anything made the API's correctness (live queue recomputation, error texts, log writes) more
directly observable than a GUI session would have.

## Methodology / stats

Pure CLI + HTTP pilot per `docs/usability-testing.md`'s variant rules: no checklist, no source
reading (the rate page HTML was read as a served asset, i.e. as the UI under review), every
command's output read before the next command. ~35 minutes wall (dominated by the 1-minute vary
render and the self-inflicted 120s hang on the swallowed `--prot` flag), ~25 commands. Scratch dir
under the session scratchpad, deleted after; all servers killed; 5 batches rated (3 vary, 2 gen,
stub gen backend), 5-entry `beat-scores.jsonl`, eval run with `--embed-backend stub --aes-backend
stub`.

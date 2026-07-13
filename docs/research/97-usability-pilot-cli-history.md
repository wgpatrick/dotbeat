# Usability pilot 97: CLI-only version history (`checkpoint`/`history`/`restore`/`pin`)

## Intro

Goal: build a small real track (2 tracks, a lead groove, a bassline, some mix tweaks) purely
through `beat` CLI commands, discovering `checkpoint`/`history`/`restore`/`pin`/`unpin`/`pins`
syntax cold from the tool's own usage banner — no GUI, no reading source until a wall was hit.
Ground truth was cross-checked against the git repo that backs history (`.git` inside the scratch
project dir) at every step, not just command output.

## Narrative walkthrough

Ran `beat` with no args — the full usage banner appeared, listing every subcommand including the
six history ones with inline syntax (`beat checkpoint <file> [--label L] [--intent I]`, etc.). No
need to guess; the whole surface was legible in one screen. `beat --help` and `beat help` both fall
back to the same banner, which is convenient, but per-subcommand `--help` (e.g.
`beat history --help`) is *not* special-cased — it's swallowed as if it were the `<file>` arg and
produces a "needs `<file>` [...]" error. Harmless in practice since the error line itself restates
correct usage, but a real `--help` short-circuit per-subcommand would be more idiomatic.

Built the project: `init --bpm 120` gave a starter "lead" track. First `add-note` calls used
velocity `100` (MIDI-style habit) and all four were rejected: `velocity must be 0..1, got 100`.
Clean, correct error — but the usage banner's `add-note` line doesn't hint at the 0..1 range up
front, so this was discovered only by trial and error. Retried with `0.9`, got a real 4-note groove
(u100001..u100004). `beat inspect` confirmed track state before committing anything.

`beat checkpoint song.beat --label "first groove"` worked immediately: printed
`checkpoint ef74a8f  2026-07-12T23:30:08-07:00  first groove`. Checked ground truth — a `.git` dir
sits right in the scratch project directory, `git log --oneline` showed exactly one commit,
`ef74a8f`, subject "first groove". The checkpoint id *is* the git short hash. Added a `bass` synth
track with a 4-note bassline, checkpointed `"added bass"` (84a54d0). Tweaked `lead.cutoff`,
`bass.cutoff`, and added a second eq3 insert to `lead`, then checkpointed `"final mix"` with
`--intent "brighten lead, tame bass, extra eq"` — the intent showed up both in `beat history`
(`(intent: ...)`) and, per `git log --format='%H %s%n%b'`, as a literal `Intent: ...` trailer in
the commit body. `beat history song.beat` listed all three, newest-first, labels/timestamps/order
all sane.

Tried a no-op checkpoint next (no edits since "final mix"): `no changes since the last checkpoint —
nothing to save`, exit code 0, and `git log` confirmed no new commit was created. Correctly refused,
not a no-op commit.

Then the undo scenario: deleted two lead notes and set `bpm` to 200 — deliberately **without**
checkpointing this bad state first (a very realistic slip: "let me try this... no, undo"). First
tried a deliberately wrong ref, `beat restore song.beat notarealref123` → clean
`error: unknown checkpoint "notarealref123"`, exit 2. Good. Then restored to the real "final mix"
ref (`1b099fe`) and got: `that version is already the current one — nothing changed`. `beat inspect`
right after showed the *correct* pre-bad-edit state (bpm 120, 4 lead notes) — so the restore
**did** something, despite the message claiming otherwise. That mismatch was suspicious enough to
warrant isolating it. See Findings — this turned into the pilot's headline bug.

Built a clean, controlled repro: at a clean checkpoint, made one uncommitted edit (`bpm 140`),
ran `restore` to the ref HEAD already pointed at, got the same "already current — nothing changed"
message, and `git status`/`inspect` showed the `bpm 140` edit had been silently discarded, reverted
to 120, with zero new commits. Went further: repeated with an uncommitted `bpm 155` edit and
restored to an **older** checkpoint instead (`ef74a8f`, two checkpoints back) — this time `restore`
reported success (`restored — new checkpoint 547bd8c ...`) and *did* create a new commit, but
`git log --all -p | grep 155` across all refs came back empty: the `155` edit was never captured by
any commit, anywhere. It is permanently gone. This directly contradicts the CLI's own promise —
`beat restore <file> <ref>` is described in the top-level banner as `append-only — never destroys
work`.

Moved on to pins. `beat pin song.beat 1b099fe final mix v1` → `pinned 1b099fe as "final mix v1"`.
`beat pins song.beat` listed it. Checked `beat history --collapsed`: the unpinned checkpoints
collapsed into `... N more checkpoints ...` runs while the pinned one stayed expanded, tagged
`[pin: final mix v1]` — exactly matching the intent described in `history.ts`'s own doc comment.
Ground-truthed the pin directly: `git tag -l` showed `pin/final-mix-v1`, and
`git cat-file -p` on it showed an *annotated* tag object (`tagger dotbeat <history@dotbeat.local>`)
whose message is the literal display name `"final mix v1"` — confirms the round-trip-without-
lossy-slugging claim in source. Exercised edge cases: pinning a nonexistent ref, a >25-char name, a
duplicate name — all three failed with clear, correct, differentiated error messages and exit code
2. `unpin` removed the pin (`pins` went back to `no pins yet`, `--collapsed` fully collapsed to
`... 4 more checkpoints ...`) without touching the underlying checkpoint — `history` (uncollapsed)
still listed it. Re-pinned it, then discovered (accidentally, not from any help text) that `restore`
accepts the raw tag ref (`pin/final-mix-v1`) directly as `<ref>`, not just short hashes — restored
cleanly and `inspect` confirmed the exact final-mix state came back byte-for-byte correct (cutoff
3200/800, second eq3 present, 4 lead notes).

Went back to source (`src/history/history.ts`) after the restore-vs-message mismatch to understand
root cause, and to check what pinning is actually supposed to protect against per the tool's own
doc comment: "nothing `restore`'s append-only model can invalidate (a tagged commit is never
deleted)". Grepped the whole `src/history` and `cli/` trees for any prune/gc/expire mechanism —
found none. In the current implementation nothing is ever deleted regardless of pinning (every
checkpoint stays reachable from `master`'s linear history forever), so pinning's real, verified
effect today is naming + `--collapsed`-view visibility, not protection from any actual deletion
risk — the doc comment's framing is aspirational/future-facing, not descriptive of present behavior.

## Findings summary

- **[bug] `beat restore` can silently and permanently destroy uncommitted work, contradicting its
  own advertised "append-only — never destroys work" guarantee.** Root cause in
  `src/history/history.ts` `restore()`: it calls `writeFileSync(abs, content)` unconditionally
  before ever checkpointing the pre-restore state, so any edit made since the last checkpoint is
  overwritten with no commit ever capturing it. Repro: checkpoint at state A, edit `bpm` to some
  uncommitted value, `beat restore <file> <any-other-ref>` — the edit is gone from `git log --all -p`
  everywhere, unrecoverable. This is core `src/history` behavior, not CLI-specific — the MCP tool
  (`src/mcp/server.ts` calls the same `restore()`) and any future GUI "restore" button would have
  the identical hole. Fix candidates: have `restore()` checkpoint (or stash) the current dirty state
  before overwriting, or refuse/warn when the working tree is dirty and the target isn't a superset.
- **[bug] Misleading message compounds the above**: when the restore target happens to equal the
  current HEAD ref, `restore` prints `that version is already the current one — nothing changed`
  even though it just silently discarded a real uncommitted edit — the message describes "no new
  commit needed" (true) as if it meant "the file didn't change" (false). A user reading this message
  would reasonably conclude their restore was a no-op and look elsewhere for their missing edit,
  not realize it was just erased.
- **[confusing] `add-note`'s velocity range (0..1) isn't hinted in the top-level usage banner**,
  only enforced after the fact with a (correct, clear) error. A MIDI-conditioned user's first
  instinct (velocity 100) fails four times before they infer the scale from the error text alone.
- **[confusing] Pin's "protects against" framing is aspirational, not real yet.** The `pin()` doc
  comment and mental model imply pins protect a checkpoint from being lost; verified against source
  and a full grep, there is currently no prune/gc/expiry mechanism in dotbeat's history system at
  all, so unpinned checkpoints are exactly as permanent as pinned ones today. Pinning's only
  presently-observable effect is a human-readable name plus staying expanded in
  `history --collapsed`. Not wrong, just ahead of an implementation that doesn't exist yet — worth
  either building the pruning it implies or softening the doc language.
- **[slow-to-discover] Per-subcommand `--help` isn't special-cased** (`beat history --help` errors
  as if `--help` were the file argument) — self-correcting since the error restates usage, but not
  idiomatic. `beat --help`/`beat help` at the top level do work and dump the full banner.
- **[worked well] Checkpoint ids are real, inspectable git short hashes**; `beat history`'s
  order/timestamps/labels/intent all matched `git log` exactly, no daylight between the tool's
  claims and ground truth for the happy path.
- **[worked well] `--intent` round-trips faithfully** as a literal `Intent: ...` git trailer, visible
  both via `beat history` and raw `git log`.
- **[worked well] No-op checkpoint correctly refused** (`nothing to save`, no phantom commit) rather
  than creating timeline noise.
- **[worked well] All pin edge cases handled cleanly**: bad ref, >25-char name, duplicate name each
  produced a distinct, correct, exit-2 error; `unpin` removes only the name, not the checkpoint;
  `restore` even accepts a pin's raw tag ref as `<ref>`, undocumented but a nice bonus for anyone who
  pokes at the git internals.
- **[worked well] Unknown restore ref fails loudly and immediately** (`unknown checkpoint "..."`,
  exit 2) rather than silently no-oping.

## Where the pilot deviated from the ideal workflow

Had to deliberately construct a controlled, minimal repro (clean checkpoint → one uncommitted edit
→ restore) to isolate the data-loss bug from the noisier first encounter, and read
`src/history/history.ts` after hitting that wall to confirm root cause — both allowed under the
pilot's own rules once a genuine anomaly appeared.

## Verdict

Mostly yes: a new user could discover and drive `checkpoint`/`history`/`pin`/`unpin`/`pins` entirely
from `beat`'s own usage banner and error text — the happy paths are clean, well-labeled, and truthful
against git ground truth. But the CLI's own words promise `restore` is "append-only — never destroys
work," and that promise is false in the ordinary case of restoring while an edit sits uncommitted —
a completely realistic slip for anyone treating checkpoints as an undo history rather than
git-literate commit discipline. Until that's fixed, this reviewer would not trust `beat restore` with
real work without checkpointing obsessively before every restore — which defeats much of the point
of an "it just handles versioning for you" pitch.

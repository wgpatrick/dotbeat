# Research 28 — Multi-level in-session undo/redo vs. the git-checkpoint history system

*2026-07-11. Phase 23 Stream RD. Internal design pass, not source archaeology — grounded directly
in dotbeat's own source (`src/core/edit.ts`, `src/daemon/daemon.ts`, `src/history/history.ts`,
`ui/src/state/store.ts`, `ui/src/daemon/bridge.ts`, all read at `main`), plus dotbeat's own prior
research (`docs/research/11-versioning-ux.md`, `docs/opendaw-notes.md` §7,
`docs/research/23-opendaw-collaboration-storage.md` §2.5) and `docs/decisions.md` D8/D10. This area
was fully unscoped going in (`research: null` in `scripts/roadmap-data.mjs`, area "Undo / redo
(in-session)") — no prior doc had designed it. Unlike research 11 (a 104-agent adversarially
verified deep-research pass on external prior art), this is a single-pass design analysis; external
claims are flagged with their confidence level rather than presented as verified.*

## 0. What's actually there today (read from source, not assumed)

Three distinct layers already exist, and it's worth being precise about which one is which before
proposing a fourth:

1. **The daemon's in-memory `doc`** (`src/daemon/daemon.ts`, `startDaemon`) — the live
   `BeatDocument`, held in a closure variable, mutated by every edit route. There are **15+
   document-mutating POST routes** (`/edit`, `/song`, `/audio-split`, `/automate`, `/add-track`,
   `/remove-track`, `/effect-add`, `/effect-remove`, `/effect-move`, `/effect-enabled`, `/group`,
   `/new-project`, `/restore`, `/vary`-apply, `/library/apply-preset`, …), and every one of them
   funnels through one choke point: `writeIfChanged(nextDoc)` (`daemon.ts:491`), which
   canonical-compares, writes the `.beat` file, and reassigns `doc = parse(nextText)`. This is the
   single place a document actually changes.
2. **The `.beat` file on disk** — written on *every* edit via `writeIfChanged`, unconditionally,
   with **no versioning at all**. A knob nudge and a track deletion look identical to the
   filesystem: the old bytes are simply gone once overwritten.
3. **Git checkpoints** (`src/history/history.ts`) — a *separate*, **explicit** action
   (`checkpoint()`, called by `beat checkpoint` / the daemon's own future intent, not by
   `writeIfChanged`). Each checkpoint is a full-file `git commit` (`git add` + `git commit`, via
   `execFileSync`), labeled with the semantic diff (`diffDocuments` against `HEAD:<file>`, formatted
   by `formatDiff`). `restore()` (the History panel's "Go back") is append-only by construction: it
   writes old bytes to disk, then calls `checkpoint()` again — it never runs `git reset`/`--amend`/
   `commit --amend`. Phase 15's own verification (`docs/phase-15-history-panel.md`) confirms this is
   genuinely non-destructive: restoring commit N still leaves commit N intact and reachable.

Critically — and this is Phase 15's own documented finding, re-confirmed here — **checkpointing is
not automatic today**. `beat set`/`beat add-note`/every daemon edit route writes the file (layer 2)
but calls no `checkpoint()` (layer 3). Only an explicit `beat checkpoint` (CLI/MCP) or a future
wired-up GUI action mints a checkpoint. So today, between two checkpoints, an arbitrary number of
edits can happen with **zero recovery path** if something goes wrong — which is exactly the gap
Ctrl+Z is supposed to fill, and exactly why layers 1-2 (session-live, ungoverned) and layer 3
(durable, git-backed, deliberately sparse) are already, structurally, two different things.

**Ctrl+Z currently does nothing.** Confirmed in two places: `scripts/roadmap-data.mjs`'s own row
("area: 'Undo / redo (in-session)' ... Stripped from the original BeatLab port and never rebuilt —
Ctrl+Z currently does nothing") and `ui/src/components/TransportBar.tsx`'s header comment, which
lists "undo/redo" explicitly among the things stripped from BeatLab's port and never rebuilt. There
is exactly one *inspired-by-undo* mechanism in the GUI today — `ui/src/daemon/bridge.ts`'s
vary-and-audition "undo" (~line 303) — but it's local to `VaryAffordance.tsx`'s in-memory preview
(discard an unapplied batch of variant edits before "keep" ever posts them). It never touches the
daemon, never touches disk, and has nothing to do with the document's actual edit history. It's a
useful naming precedent (dotbeat is already comfortable with a small, ephemeral, ungoverned "undo"
next to the git-governed one) but not infrastructure to build on.

`docs/decisions.md` D8 already stakes out a direction, even though nothing has been built toward it
yet: *"the semantic diff (`src/core/diff.ts`) produces a typed `DiffEntry[]` where every entry
carries `before`/`after` — and this same shape is reserved as the future undo and `--dry-run`
representation."* Confirmed by reading `src/core/diff.ts` directly: every one of its ~35 `DiffEntry`
variants (`note-changed`, `effect-added`, `audio-region-changed`, …) does carry enough information
to be inverted (swap `before`/`after`, or `-added`↔`-removed`). **But no `applyDiff()` function
exists anywhere in the codebase** — `diffDocuments()` (compute) and `formatDiff()` (render as text)
exist; nothing consumes a `DiffEntry[]` and produces a new `BeatDocument`. D8's own "Revisit when"
line flags the real remaining gap precisely: *"undo lands and needs transaction grouping (multiple
entries per user gesture) — grouping metadata may need to join the shape."* This research treats
that revisit as now due.

## 1. Separate stack, or the same mechanism as checkpoints?

**Recommendation: separate, in-session, in-memory stack. Do not merge Ctrl+Z into the git-checkpoint
mechanism, and do not make checkpointing dramatically more granular to compensate.** Three
independent lines of evidence converge on this, not just intuition:

**(a) Every piece of prior art dotbeat has already researched keeps them separate.** Research 11 §1
found Figma, Cursor, and Claude Code *all* run a coarse, event-based auto-checkpoint layer that
coexists with — never replaces — each tool's own native, fine-grained undo (the browser's/editor's
own Ctrl+Z). Cursor's checkpoints are explicitly framed as a safety net ("use Git for permanent
version control"), not an undo replacement. Research 11's own "open questions carried forward"
section already anticipated this exact question and pre-answered it: *"Photoshop history states —
… in-session undo is a different mechanism than persistent versions, and we already plan both."*
Research 23 §2.5 independently reinforces it from a different angle: openDAW's `SyncLogService`
(a hash-chained, git-commit-shaped local transaction log, unrelated to their live-collab CRDT layer)
is the closest thing in their codebase to dotbeat's checkpoint model — and dotbeat's own verdict on
adopting it was **"Skip (redundant)": a second, bespoke, hash-chained history log duplicates what
git already gives for free.** The same logic applies in reverse here: making checkpoints granular
enough to double as an undo stack would be building a *third* history mechanism (git commits, at
keystroke granularity) to replace a second one (an in-memory stack) that's cheaper and already the
industry-converged shape.

**(b) It's a hard performance/engineering mismatch, not just a UX one.** `checkpoint()` shells out to
a real `git commit` (`execFileSync`, `daemon.ts`'s history routes) — a process spawn plus a
filesystem write to `.git/objects` per call. `ui/src/components/Knob.tsx`'s `onPointerMove` fires
`onChange` → `postEdit` → `writeIfChanged` on **every pointer-move tick during a drag** — a single
knob gesture can be dozens of calls. Auto-checkpointing at that granularity would flood the git log
with dozens of commits per knob nudge, directly undermining the "skimmable, semantically-labeled
timeline" property research 11 §1 and the History panel (Phase 15) were built around — collapsed
view or not, that's real spawn-and-fsync overhead the daemon would eat on every pixel of drag, for
no product benefit.

**(c) They're not, in fact, two competing "which one wins" mental models — they're two tiers of the
same idea, and that framing should be surfaced to the user rather than hidden.** Both mechanisms
answer "take the document back to an earlier state"; they differ in retention and granularity, not
intent. The recommended framing, worth stating in the eventual product spec: **Ctrl+Z is the fast,
cheap, session-scoped undo any editor has; the History panel is the durable, named, git-backed
memory that survives forever.** When the in-memory stack runs out (deep session, or app restart —
see §4), the History panel's own "Go back" *is* the fallback, and it already works today
(`restore()`), just at checkpoint granularity instead of edit granularity. No new merge logic is
needed to make these compose — they're already complementary by construction, they just need to
both exist. The only real coordination work is UI: label the History panel's "Go back" distinctly
from Ctrl+Z (already true — "Go back" vs. no current Ctrl+Z binding) so a user never wonders which
one they just triggered.

## 2. Full-document snapshots vs. inverse-edit replay

**Recommendation: full-document snapshots, not per-primitive hand-written inverses.** This is the
one place this research pushes back hardest on the framing in the brief ("full snapshots: simple,
memory-heavy" vs. "inverse replay: memory-efficient") — for dotbeat specifically, that tradeoff
mostly evaporates once you look at actual document sizes and actual primitive shapes.

**Document size makes "memory-heavy" not a real cost.** dotbeat's format is deliberately a compact,
human-readable text format (D1: document-only, no generator layer; D9: canonical elision keeps only
non-default fields present) — this isn't incidental, it's a named design goal. Measured directly:
`examples/night-shift.beat` is 2,949 bytes; `examples/real-groove.beat` is 3,144 bytes;
`examples/night-shift-song.beat` (a full song-structure project) is 4,697 bytes. Even a large,
long-session project is very unlikely to clear the low tens of KB as text; the in-memory
`BeatDocument` object graph (parsed arrays of note/hit/effect objects) is larger than the serialized
text but still trivially small — nowhere near "heavy" for a desktop app. A 200-level undo stack of
full snapshots at even a generous 200KB/snapshot in-memory is 40MB: irrelevant on any machine dotbeat
targets. The "memory-heavy" framing is real advice for DAWs that snapshot raw audio buffers or large
binary state (which is why real DAWs' undo stacks avoid it) — it doesn't transfer to a format whose
entire reason for existing is being small and text-shaped.

**Per-primitive inverses are not uniformly realistic**, audited directly against
`src/core/edit.ts`'s ~35 exported primitives:

- **Clean, symmetric pairs exist**: `addEffect`/`removeEffect` (matched by a deterministic or
  caller-supplied `id`; `removeEffect(id)` is a correct inverse of `addEffect(...) → {id}` *if* you
  also restore its original chain index, which `addEffect`'s `opts.index` supports — doable, but
  already requires capturing more than just "call the opposite function").
- **Batch operations have no natural single inverse.** `quantizeNotes` (edit.ts:408) moves every
  note/hit in a scope by `amount * (grid-snap delta)` — a partial, per-entity move whose exact
  before-state (`start`, `duration` per note) is not recoverable from the forward call's arguments
  (`grid`, `amount`, optional `noteIds`) alone. Inverting it correctly requires having captured each
  touched note's prior `(start, duration)` — i.e., you need a diff or a snapshot *anyway*, a
  hand-written `unquantizeNotes` inverse function would just be reimplementing diff capture badly.
- **Some primitives have no inverse function at all.** `splitAudioClip` (edit.ts:1084) mutates the
  original clip's `audio.out` *and* creates a brand-new clip with an auto-generated id
  (`${clipId}-2`, `-3`, …) and repartitioned automation lanes. There is no `joinAudioClip` anywhere
  in `edit.ts`. Writing one — delete the second clip, restore the first clip's exact `out` and
  automation partition — is buildable, but it's genuinely new code with its own edge cases, not a
  free byproduct of the forward primitive already existing.
- **Auto-generated ids break naive "replay the same call" redo.** `addEffect` without `opts.id`,
  and `splitAudioClip` without `opts.newClipId`, both mint ids from existing state
  (`type`/`type_2`/…, `${clipId}-2`/`-3`/…). Undo/redo must operate on the *concrete result* of the
  original call (the actual id it picked), not re-invoke the primitive with the user's original
  arguments — another reason a bespoke `.inverse()` per primitive, keyed only on the call's inputs,
  doesn't compose cleanly across ~35 primitives of varying shape.

Given that, hand-authoring and maintaining a correct `.inverse()` for every current and future
edit primitive (and every primitive gets touched by 5+ active phase streams a cycle, per
`docs/phase-23-plan.md`) is real, ongoing maintenance surface for a benefit — memory — that isn't
actually scarce here. **Full snapshots win on both simplicity and correctness for this specific
document format.** The pragmatic middle ground, if snapshot memory ever does become a real concern
at much larger project sizes than exist today, is D8's own planned shape: capture `diffDocuments(prev,
next)` (already computed elsewhere — `history.ts`'s `checkpoint()` calls this exact function today
to build the semantic commit label) instead of the full `prev` document, and build the one missing
piece, `applyDiff(doc, DiffEntry[], direction)`, generically once against the diff representation —
never against the primitives. That gets inverse-replay's memory benefit without inheriting
per-primitive inverse-maintenance burden, because it inverts the generic *output* (a diff) rather
than reimplementing the *input* (35 different call shapes). This research's recommendation for an
MVP (§5) is still: start with full snapshots (zero new inversion logic needed, ships fastest,
correct by construction), and only move to diff-based storage later if profiling on real large
projects shows it's warranted — not preemptively.

## 3. Undoing past a checkpoint boundary

This is the genuinely hard question, and the brief's framing of the two obvious answers is right
that both are bad: silently rewriting a checkpoint's committed bytes violates Phase 15's own
non-negotiable property (checkpoints are immutable — `restore()` itself is built specifically to
never do this, and D10's pin tags rely on commits never disappearing), while refusing to undo past a
checkpoint boundary is a UX regression no DAW user would accept (nobody expects Ctrl+Z to stop
working because *someone, at some point, saved*).

**The resolution is that this isn't actually a dilemma, once layer 2 and layer 3 (§0) are kept
properly separate: undoing past a checkpoint never needs to touch git at all, so there is nothing to
protect against.** A git checkpoint is an immutable snapshot of what the *working file* contained at
one instant. It places **no constraint whatsoever** on what the working file may contain a moment
later — that's what "working tree" means, and it's exactly the property `restore()` already
exploits: `restore()` (`history.ts:275`) walks arbitrarily far back in git history by *writing bytes
to the live file* and is careful to never touch already-made commits. Ctrl+Z should do the identical
thing, just from a cheap in-memory source (a snapshot or diff, §2) instead of `git show <ref>:file`.
Concretely:

- Undoing past a point where a checkpoint was made **just overwrites the daemon's in-memory `doc`
  and the on-disk `.beat` file** (the same `writeIfChanged` path every other edit already uses — no
  new write mechanism needed). The checkpoint commit itself is untouched, still reachable by ref,
  still restorable, still pinnable — nothing about it changes.
- **Undo does *not* auto-mint a new checkpoint on every step.** That would reintroduce exactly the
  granular-commit-spam problem §1(b) argues against, and it breaks with dotbeat's own existing
  design (§0: even ordinary edits don't auto-checkpoint today). The working file is left in whatever
  state undo landed on, exactly as an ordinary uncommitted edit would be.
- The **next explicit checkpoint** (an agent's batch, a user's "Checkpoint" click, or an eventual
  auto-checkpoint-on-save policy) simply captures wherever the document happens to be — which is
  correct and honest: if a user checkpoints, edits, undoes past that checkpoint, and checkpoints
  again, the git log ends up with two real commits, the second one's semantic label truthfully
  describing what actually changed ("bass: note u100040 removed," say) relative to the first. Nothing
  is hidden, nothing is rewritten, and the append-only philosophy (research 11 §2, Phase 15) holds
  without a single special case for "what if undo crosses a checkpoint."

No confirmation dialog is warranted for crossing a checkpoint boundary during undo — doing so is,
by the argument above, exactly as safe as any other undo step, and every DAW's Ctrl+Z already
crosses "I saved a while ago" boundaries freely (that's the entire "Ableton pain" research 11 §5
documents — Ableton's actual failure mode was the opposite: undo history gets wiped *on* save,
destroying recoverability, which is precisely the bug dotbeat's git layer exists to fix *for the
persistent layer*; it says nothing about whether the session-local layer should gate itself on save
points, and nothing in dotbeat's architecture requires it to).

One related edge case worth naming for the implementation, surfaced by reading `daemon.ts` directly:
`onFileMaybeChanged` (daemon.ts:452) reconciles the in-memory `doc` whenever the `.beat` file changes
*externally* (a hand edit, an agent's CLI call, another process). An in-session undo stack that
doesn't also observe this channel could get out of sync with reality — e.g., a CLI `beat add-note`
lands between two GUI edits, the user Ctrl+Z's, and the undo stack "restores" a state that predates
the external edit, silently discarding it. The clean answer, consistent with keeping the undo stack
daemon-side (§5): treat an external file change as an undo-stack-clearing event, the same way a
checkpoint's `restore()` already treats external state as authoritative. This isn't a checkpoint
question, but it's the sibling hard edge case and should be handled by the same implementation.

## 4. Session boundary: does undo persist across restarts?

**Recommendation: session-only. The in-memory undo stack is cleared on daemon restart / project
close, with no attempt to persist it.** Grounds for this, roughly in order of how much weight each
should carry:

- **It's already dotbeat's own stated assumption**, not a new position invented for this doc:
  research 11's "open questions carried forward" explicitly frames in-session undo and persistent
  version history as *two different mechanisms* dotbeat "already plan[s] both" of — the natural
  reading being session-scoped-undo-plus-durable-checkpoints, the same split every tool it surveyed
  (Figma/Cursor/Claude Code) uses, none of which persist their fine-grained undo stack the way their
  coarse checkpoint layer persists.
- **General software convention** (informal — not adversarially verified the way research 11's
  claims are, flagged accordingly): both creative tools (Photoshop's History panel is documented by
  Adobe as clearing on file close) and code editors (VS Code's undo/redo stack does not survive
  reopening a file) treat in-buffer undo as buffer-lifetime state, distinct from any durable
  save/version mechanism. This is offered as a directionally-consistent norm, not a verified,
  cited fact the way research 11's Figma/Cursor findings are.
- **Persisting it would mean building real infrastructure for a marginal, arguably-negative benefit.**
  A stack that survives app restart needs its own on-disk format, its own staleness rules against
  external edits (§3's `onFileMaybeChanged` edge case, but now spanning a restart, where the
  likelihood of an external edit having happened is much higher), and its own answer to "what happens
  if the .beat file changed on disk while the app was closed and the persisted stack doesn't know."
  None of that is free, and the payoff — undoing something from a *previous* session — is exactly
  what the git-checkpoint History panel already exists to do, deliberately, durably, and with a
  readable semantic label instead of an opaque "undo step 47." Persisting the in-memory stack would
  be building a second, worse version of the History panel for the cross-session case.
- **CRDT-backed tools, which the brief specifically asked about, generally *don't* give this for
  free either** — worth noting since it could look like an obvious counterexample. A CRDT's
  operation log is what enables both live sync and, incidentally, time-travel undo, but common CRDT
  undo implementations (e.g. Yjs's `UndoManager`) scope undo to a transaction-origin and a live
  document session; persisting undo across a full close/reopen requires persisting the entire CRDT
  op history indefinitely, which is a real storage-growth cost most CRDT apps don't take on just for
  undo. dotbeat isn't CRDT-backed at all (research 23 §3: local git-merge was the deliberate
  alternative to a CRDT layer) so this isn't a mechanism available "for free" here regardless.

## 5. Recommended MVP scope

A concrete, buildable slice for a future build stream, ordered so each piece is independently
useful and nothing here is speculative — every integration point below is a real, named file/line
read during this research, not a guess:

1. **Daemon-side stack, not client-side.** The daemon already owns the single source of truth
   (`doc`, `daemon.ts`) and is the one place all 15+ mutating routes converge
   (`writeIfChanged`, `daemon.ts:491`). Add an undo/redo stack (two arrays of full `BeatDocument`
   snapshots, §2) as daemon-process state, alongside the existing `selection` closure variable.
   Wrap `writeIfChanged` itself — push the pre-write `doc` onto the undo stack and clear the redo
   stack — rather than instrumenting each of the 15+ routes individually; this is the one choke
   point every current and future mutating route already passes through.
2. **New routes, same shape as `/restore`.** `POST /undo` and `POST /redo`, each popping/pushing a
   snapshot, writing it via the same `writeIfChanged` path (so the SSE `doc` broadcast, external-edit
   reconciliation, and the GUI's existing hot-reload all work unmodified — no new sync channel).
3. **Gesture-level coalescing, not per-write-call granularity.** §1(b)'s finding is concrete and
   must be designed around, not discovered later: `Knob.tsx`'s drag fires many `writeIfChanged`
   calls per gesture. Push one undo snapshot per *gesture* (on `onPointerUp`/drag-end, or via a short
   idle-debounce keyed by the same track+param), not one per pointer-move tick — otherwise Ctrl+Z on
   a knob nudge would take dozens of presses to undo the perceived single action. This is exactly
   the "transaction grouping" D8's own "Revisit when" line already flagged as the missing piece.
4. **Bound the stack depth** (e.g. 100-200 snapshots) rather than unbounded — cheap given §2's size
   numbers, but still worth an explicit cap so a very long editing session has a hard ceiling rather
   than unbounded growth.
5. **Wire Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z in `App.tsx`**, extending the exact pattern already
   established for Shift+Tab (`App.tsx`, the `onKey` handler ~line 118): a global `keydown` listener
   with the same form-control guard (skip when focus is in an `INPUT`/`SELECT`/`TEXTAREA`/
   `contentEditable`, so it doesn't hijack the BPM field or a text input) that POSTs `/undo` or
   `/redo` instead of dispatching locally — consistent with every other edit in this app going
   through the daemon rather than mutating client state directly (`bridge.ts`'s documented
   file→GUI/GUI→file model).
6. **Session-only (§4)**: no persistence, no new file format. Cleared on daemon restart. `TransportBar`
   or a small status affordance can grey out Undo/Redo when the respective stack is empty — cheap,
   standard, and worth doing given there's currently zero visual affordance that undo exists at all.
7. **Explicitly out of scope for the MVP**: diff-based (rather than full-snapshot) storage (§2's
   fallback, only worth it if profiling on real large projects shows snapshot memory is actually a
   problem — no evidence of that yet); persisting the stack across restarts (§4); any
   checkpoint-boundary special-casing or confirmation UI (§3 — there is genuinely nothing to special-
   case); auto-checkpoint-on-every-edit (a separate, larger product decision `docs/phase-15-history-
   panel.md` already flagged as unwired and out of this stream's scope — conflating "wire up
   auto-checkpoint" with "build Ctrl+Z" would be scope creep across two genuinely different features).

## Summary

In-session undo/redo and the git-checkpoint history system should stay two separate mechanisms, not
be merged or made to share a cadence — every piece of prior art dotbeat has already researched
(Figma/Cursor/Claude Code via research 11, openDAW's own redundant-Sync-Log verdict via research 23)
converges on exactly this split, and merging them would mean auto-checkpointing at a granularity
(per pointer-move tick) that's a real performance problem for a mechanism (`git commit` via
`execFileSync`) not designed for that frequency. The in-session stack should hold full `BeatDocument`
snapshots, not hand-written per-primitive inverses — an audit of `src/core/edit.ts`'s ~35 primitives
found batch operations (`quantizeNotes`) and operations with no existing inverse (`splitAudioClip`)
that make uniform per-primitive inversion impractical, while dotbeat's own document format is small
enough (3-5KB on real example projects) that snapshot memory is a non-issue. Undoing past an
already-made checkpoint is safe by construction and needs no special-casing: a checkpoint is an
immutable commit of a past working-tree state, and undo only ever mutates the *current* working tree
through the same write path every other edit already uses — nothing about that touches git, so
nothing about it can violate Phase 15's append-only, immutable-checkpoint guarantee. The stack should
live in the daemon (the actual source of truth, and the one place every mutating route already
converges through `writeIfChanged`), be session-only (cleared on restart, matching both dotbeat's own
prior assumption in research 11 and the general convention in creative/code tools), and — the one
concrete implementation risk this research surfaced that isn't in the original brief — must coalesce
by user gesture rather than by raw write call, or a single knob drag will require dozens of Ctrl+Z
presses to undo.

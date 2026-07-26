---
name: produce-song
description: This skill should be used when asked to produce, craft, cover, or finish a COMPLETE song with dotbeat — "produce a song", "make a serious cover of X", "build a full track", "take this from idea to final render" — anything bigger than editing a loop or a single pattern. It is the stage-gated production workflow distilled from the Sandstorm-cover craftsman sessions (docs/research/121-harness-engineering-for-music-agents.md): six phases, each naming its instruments and its exit gate, plus the checkpoint-listen protocol that schedules the owner's ears. Load it BEFORE starting any full-song run, alongside the dotbeat skill (which covers the command surface itself).
---

# produce-song: stage-gated full-song production

One observed law drives this skill (research 121, headline 3): **agents use exactly the tools their
prompt names, at the altitude it names them.** The Sandstorm craftsmen were told "metrics + lint
are your ears" — so they hand-rolled worse versions of `beat feedback --sections` and
`beat render --stems`, which existed in their own worktree, and never touched the produce/trick
layer. This document is therefore a checklist of named instruments per phase, not a catalogue.
When a phase names a verb, use that verb. Never re-implement a named verb as a shell or python
script.

Read the dotbeat skill first (command surface, render caveats, checkpoint discipline). Everything
below assumes it.

## Ground rules (before phase 1)

- **Establish a workshop directory explicitly at start** (e.g. `workshop/` next to the project)
  and confirm the Write tool can touch it — Write is often scoped to the worktree while the
  deliverable lives outside; discover this with one probe, not six mid-flight failures.
- **NOTES.md in the workshop is mandatory** — a running log of decisions, measurements, auditions,
  failures. It is cross-session memory: a stopped agent's successor must be able to reconstruct
  the entire state from the workshop files plus NOTES.md alone (this worked once already).
- **Checkpoint discipline**: `beat checkpoint --intent` after every batch that fulfills one goal;
  `beat pin` the milestones.
- **Prime directive: a render that fails a known check NEVER reaches the owner's ears.** Both
  owner-caught failures on Sandstorm were measurable before the listen; one was already measured.

## Phase 1 — Research

Instruments: WebSearch/WebFetch · `docs/tricks-reference.md` + relevant `docs/research/*` ·
`beat metrics [--save-profile]`.

1. Web pass on the target sound: what physically makes it (Sandstorm's lead turned out to be a
   distorted mono line, not a supersaw — five NOTES.md conclusions traced to this pass).
2. Repo evidence: the tricks-reference numbers are your mix targets (stereo width, air-band %).
3. Reference measurement: `beat metrics` on 2-3 owner-loved reference tracks, per-section where
   possible; `--save-profile` so phase 6 can run `feedback --ref`. Calibrate targets from
   measurement, never genre lore.

**Exit gate:** a 5-bullet "what makes it hit" list + a numeric targets table, in NOTES.md.

## Phase 2 — Source mining / material plan

Instruments: `beat analyze` (reference audio) · `beat analyze-structure` (.beat) · python/mido
activity-matrix mining for covers · the catalogues: `beat presets`, `beat surge patches`,
`beat drum-kits`.

- Covers: reduce the source MIDI to the real form via a per-block activity matrix; pick per-voice
  extraction windows *musically* (chord-aligned bars; swap chord-unsafe fragments).
- Originals: explicit motif and palette decisions, written down before building.

**Exit gate:** the per-role source table in NOTES.md (mandatory architecture table): which
instrument plays what, sourced from where.

## Phase 3 — Dynamics plan from source — BEFORE any track is built

Instruments: per-section `beat metrics` over the reference recording · the phase-2 activity matrix.

Derive per-section energy targets from the reference's *measured* arc, not vibes: LUFS deltas
relative to the drop, an instrumentation on/off matrix per section, where adjacent contrast of
3-4+ LUFS is planned, where near-silent gap bars go, and the size of the gap→drop step. The
Sandstorm flatness failure (per-8-bar rms −15.2 → −12.7, written in NOTES.md as an observation,
not a failure) happened because no plan said what contrast *should* be.

**Exit gate:** the arc table the final render will be verified against — phase 6 checks
`feedback --sections` output against exactly this table.

## Phase 4 — Per-stem build

Instruments: `beat add-track --produced` / `beat produce` · `beat trick suggest|apply` ·
`beat render --stems` · `beat metrics` · surge tracks (`beat add-track <file> <id> surge
--patch "<name>"`, `beat surge patches|doctor`) · `beat source gen` for one-shots/FX.

- One engine patch / surge patch / sample per role, from the phase-2 table.
- `add-track --produced` (or `beat produce` on existing tracks) is the default production
  baseline; `beat trick apply` for named single moves, `beat trick suggest` before polishing.
  Never hand-copy production values from docs into a generator — that's what the layer is for.
- **Audition candidates the surge-candidates way**: render N candidates ON THE ACTUAL PHRASE,
  compare measured centroid/width/crest, pick by the numbers, record why in NOTES.md. (The
  Sandstorm lead was picked from 5 patches this way and survived to the final mix.)

**Exit gate:** every stem passes a solo-stem screen rendered via `beat render --stems` — NEVER a
hand-rolled solo script. Screen each stem's crest / band shares / centroid against its role. Known
pathology signature (the grindy-bass complaint): solo bass with crest < ~10.5 AND sub-share
> ~65 % AND definition band < ~30 % ⇒ fix before proceeding.

## Phase 5 — Sections + assembly

Instruments: `beat clip` / `beat scene` / `beat song` · `beat excerpt` · background renders.

`beat excerpt <file.beat> <section...> [--out <path>]` writes a derived .beat keeping ONLY the named
song sections, tracks/scenes/clips/media untouched — sections named by scene id or name, requested
order kept. Use it for every partial render. Do NOT hand-copy a .beat and rewrite its `song` block.

- Render a cheap partial excerpt for EVERY transition — never iterate on full renders
  (~0.5× realtime; a full song is 7-8 minutes of waiting per iteration).
- Background renders: poll the artifact — check the output file's size/mtime in a loop until
  stable — never trust a single watcher; watchers die silently and stall the session.
- Song mode renders only scene-placed content: an unplaced track is SILENT (see dotbeat skill).

**Exit gate:** every planned transition auditioned via excerpt render and measured against the
phase-3 arc.

## Phase 6 — Verification gauntlet — ALL of it, in order, before any owner render

1. `beat lint` on the full render: clean, **including true peak ≤ −1 dBTP** (the owner once heard
   a +2.58 dBTP clipping render because true peak was gated last — order matters).
2. `beat feedback --sections` checked against the phase-3 arc table: adjacent contrast ≥ 3-4 LUFS
   everywhere the plan says contrast; gap bars near-silent; a big (≥ 8 dB) gap→drop step where a
   drop is planned. A flat arc (adjacent contrasts of 1-2 dB) is a FAIL, not an observation.
3. Solo-stem screens re-run on final patches: `beat render --stems` + the phase-4 pathology
   checks. (`beat lint --doc <file.beat>` also renders per-track solos to name offenders.)
4. Audio-pathology screens: `beat lint <mix.wav> --screens [--sections <file.beat>]` — the standing
   defect suite (clicks, DC offset, mono-collapse, 2-5 kHz resonance, mud, crest collapse, dead air,
   sub rumble); `--sections` adds the song map so the arrangement-flatness screen runs too.
5. Advisory only: taste critic / aes scorers if reachable — log scores in NOTES.md, never gate on
   them (T5 lesson: the critic steers only once it predicts complaints).

**Exit gate:** all green ⇒ checkpoint-listen. Any red ⇒ fix, re-run the whole gauntlet.

## The checkpoint-listen protocol — scheduling the owner's ears

Three fixed milestones: **stems done** (end of phase 4), **first full assembly**, **pre-final
polish**. At each one:

1. `beat checkpoint` + `beat pin` a pinned name (`stems-review`, `assembly-review`, `pre-final`).
2. Render a **listening packet** — never a full song as the first listen: the 3-4
   highest-information excerpts, a few minutes total — each hero stem solo ~8 bars, the
   build→gap→drop transition, the sparsest section. Sample the failure surface, honor the render
   budget.
3. Post a one-screen brief: what to listen for; which checks already passed; what you are LEAST
   sure of — your uncertainty is the owner's triage list.
4. Then **block for feedback**, or continue only on explicitly-reversible work (nothing a
   complaint would force you to unwind).

Owner feedback returns as complaints in this capture format: **timestamp/section + plain
description + suspected stem (if any)**. Each complaint triggers, in order:

1. **Localize** — which section, which stem; solo stems via `beat render --stems` make this cheap.
2. **Find the metric signature** — measure before/after until a number cleanly separates bad from
   fixed (the bass-grind fix: crest 9.6 → 11.4, definition band 28 → 37 %).
3. **Report it** — thresholds plus the before/after pair go in the final report so a permanent
   lint rule can be added. The same failure must never be shipped to ears twice.

## Working with the owner: the session rhythm

The checkpoint-listen protocol above says *when* the owner listens. This says what the owner does
with their turn and how you find out — the GUI-era handoff (research 128). It is a **file
protocol**, not a feeling: every handoff is a file in the workshop dir, so a dead session's
successor reconstructs the whole state from files alone. **The GUI is the owner's home surface** —
they pick, tune, and edit there; you meet them where they already are, and every brief hands them a
one-click way in.

**Handoff OUT — at every checkpoint-listen milestone, write `workshop/BRIEF.md`.** One screen. It
is the turn token and the record of which checkpoint the owner's session starts from. It contains,
in order:

1. **What just finished** — the phase you closed and **which checks passed** (the phase-6 gauntlet
   lines, green). One line each; the owner should not have to re-derive that the mix is clip-safe.
2. **The listening packet** — the file list from the checkpoint-listen protocol, each excerpt with
   a one-line "listen for X" (paths, not prose).
3. **Option boards** — the phase's open picks as boards. Run `beat board <dir>`: it serves an
   option-board picking UI over every UNDECIDED rendered batch under `<dir>`, each board showing its
   candidates with visible provenance (source kind / recipe / provider) and the measured features
   table; the owner picks one (with an optional note) or rejects all, and it writes `decision.json`
   into the batch dir. Put the `beat board` line in the brief. Do not fall back to pasting candidate
   paths and asking for a name in chat — that loses the provenance the board exists to show and
   leaves you transcribing picks by hand.
4. **Deep links — the owner's way into the GUI.** For every suspect track and every board winner,
   a copy-pasteable `beat open` line (this shipped — item 5, research 128 §2.2):
   `beat open <file.beat> --track <id> --view device --param <knob>` drops them onto the exact
   control to fine-tune; `--view clip` for note edits; `--view mixer` for balance. Assume a daemon
   is (or should be) running on port 8420; if none is, `beat open` prints the one line that starts
   one. Present these as the primary invitation — "open the lead's cutoff and taste it" — not a
   footnote to the CLI.
5. **What you are LEAST sure of** — your uncertainty list, which is the owner's triage list (same
   rule as the one-screen brief above).
6. A final literal line: **`state: awaiting-owner @ <checkpoint-ref>`** — the pinned ref their
   session diffs against.

Then **block, or do only explicitly-reversible work** while awaiting-owner (unchanged from the
checkpoint-listen protocol). The gated resource is owner ears, not file safety — everything is
git-reversible, so run free *between* checkpoints; never touch a track the owner has open (read
`beat selection` to see what is in focus during a co-present session).

**The owner's return path** — they pick on boards (a `decision.json` lands in each batch dir), and/
or fine-tune synths/melodies/arrangement directly in the GUI (the daemon captures every knob turn
as one canonical line — their edits are already in the file and already checkpoint-able), and/or
write complaints into `workshop/FEEDBACK.md` in the capture format (timestamp/section + description
+ suspected stem) — or say them in chat, which you transcribe into FEEDBACK.md so the record
survives the session. They end their turn with the GUI's **Save checkpoint** button (or a chat
"done") — that checkpoint bounds your diff.

**Handoff BACK — your wake-up ritual, in order (chat is the wake channel, per D14):**

1. **Read board decisions** — glob the open batch dirs for `decision.json`; each names a pick,
   runner-up, and reject notes.
2. **Diff the owner's session** — `beat diff --since <the awaiting-owner ref> <file> --rollup`:
   the net per-param before→after with tweak counts, note clusters per bar, ordered by edit mass —
   the session's *story*, not its hundreds of debounced lines. The ref is optional and defaults to
   the last checkpoint; `--json` gives the structured form. A param with a high tweak count is one
   the owner cared about and struggled with: read it that way. (Same rollup over HTTP, for a
   co-present session with a daemon up: `GET /rollup?ref=<ref>` — `&format=text` returns exactly
   what the CLI prints.)
3. **Read `workshop/FEEDBACK.md`** — the complaints; each still triggers the localize → metric
   signature → permanent-lint-rule loop from the checkpoint-listen protocol.
4. **Interpret owner edits into NOTES.md** — one paragraph of *musical* reading, not a re-log of
   the rollup: "owner brightened the bass +100 Hz cutoff and pulled the lead −2 dB — my mix was
   dark and lead-heavy." The rollup is *what* changed; you supply *why*.
5. **NEVER revert an owner edit — it is ground truth.** If an owner tweak breaks a lint gate or a
   phase-3 target (a fader push that clips the master), *raise it in the next brief with the
   measurement and propose — never apply — the fix.* The only exception is a mechanical repair the
   owner explicitly asked for. (Owner edits are the cheapest high-signal taste data the project
   collects; reverting one silently discards it and breaks trust.)
6. **Convert repeated corrections into `workshop/PREFERENCES.md`** — when rollups across sessions
   repeat a directional fix (air band up on pads, twice; hats un-quantized, every time), record it
   with evidence (dates, before/afters) and, where a threshold is expressible, propose a lint rule
   — preference-per-correction, the sibling of the complaint→lint loop.
7. **Proceed, then update the state line** — adopt the winners (`beat adopt <batch> <pick>` so the
   checkpoint that lands them records the intent), do the next phase's work, and replace the
   `state:` line when you next hand off.

Where the handoffs live, in one line: **BRIEF.md (you→owner) · boards + decision.json (owner→you,
picks) · FEEDBACK.md (owner→you, complaints) · owner GUI edits (ground truth, read via
`diff --since --rollup`) · the checkpoint stream (turn boundaries) · NOTES.md / PREFERENCES.md (the
accumulated understanding).** All text, all in git's reach, all reconstructable.

## Capability truth — tools that lie cost more than tools that are absent

- **Clip automation works in renders — use it.** The old defect (`applyParams` re-asserting the
  static patch value every 16th tick, so a −60 dB volume lane rendered at −4.6 dB) is FIXED and
  gated: `test/clip-automation-render.test.ts` decodes four committed golden WAVs rendered by the
  fixed engine, and a missing golden fails loudly rather than skipping. Write dynamics as
  automation lanes. Velocity ramps + `velToFilterAmount` (per-note: 2^(vtf·(v−0.5)·4)) remain a
  good musical tool, not a workaround you are forced into.
- **Automation is clip-scoped only.** Section-level energy changes need cloned clip variants at
  scaled velocities (Sandstorm's `b_soft` = `b_main` × 0.735). There is no timeline/section-level
  dynamics primitive yet.
- **Surge tracks**: clips/scenes on a surge track do NOT render — track-level notes only — and
  `render --batch` skips surge prep (single `beat render` / `feedback` are covered).
- **Write scope**: the Write tool may be confined to your worktree while the deliverable lives
  outside it — hence the ground-rule workshop dir; use bash for writes beyond Write's reach.
- **`beat render --offline` is exact and reproducible.** The old silent-WAV failure mode belonged to
  the retired `cli/render-offline.mjs`; since D22/D23 `--offline` computes through the same `Engine`
  on an `OfflineAudioContext`, refuses soundfont projects *by name* rather than silently, and prints
  its caveats to stderr — read them. (Since D20's seeded noise voices it is also sample-identical
  run to run.) Verifying a first render with `beat metrics` is still good practice on any pipeline,
  but not because of this. See the dotbeat skill's render caveats and
  `references/render-metrics-loop.md`.

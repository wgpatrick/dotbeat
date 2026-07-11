# Design decisions & rationale

A running log of the load-bearing choices, so future-us remembers *why*. Newest at top.

> **Verification status**: all research citations below now point at fully adversarially-verified
> claims (four passes, zero infrastructure errors on the final run) — see
> [`research/README.md`](research/README.md). Where an earlier version of a decision leaned on a
> claim that was later refuted, this is noted explicitly rather than silently fixed.

---

## D12 — dotbeat gets its own UI and product design; BeatLab code is fair game to lift (2026-07-11)

**Decision:** dotbeat's GUI is dotbeat's own *product* — its own design, its own information
architecture, not a wrapped BeatLab app, and the Tauri desktop shell (`desktop/`) stops wrapping
BeatLab's web app as its webview content wholesale. This resolves `ROADMAP.md` §11's long-open
"Relationship to BeatLab" question: **hard fork at the product level**, not "BeatLab becomes the
learn mode inside this." **Refined same day (owner)**: this is a product/design fork, not a
license to reimplement everything from scratch — copying/lifting BeatLab's actual code (React
components, engine logic, whatever fits) into dotbeat's new frontend is explicitly encouraged
wherever it's a good fit. "Own product design" was never about code purity; it was about not
being BeatLab-with-git bolted on. Don't reinvent working code for the sake of it.

**Why (owner's own words, 2026-07-11):** "dotbeat should have its own UI and its own product
design. It's serving an entirely different purpose (real production) rather than learning
(BeatLab)." The two tools have diverged goals — BeatLab is a curriculum-driven teaching sandbox
(lesson validators, a units sidebar, guided exercises); dotbeat is a git-native production tool
for people who code. Sharing a GUI meant every dotbeat-side interaction (D2 selection, D4 song
view, D5's vary-audition loop, all built or attempted across Phases 9-11) had to be retrofitted
into a codebase designed around teaching UX, and PR'd into a repo whose own priorities aren't
dotbeat's. It also quietly implied dotbeat's product identity *was* BeatLab-plus-git, which the
owner is explicitly rejecting.

**What's unaffected**: `src/core` (the format/document model), `src/daemon`, `src/mcp`,
`src/history`, `src/vary`, `src/metrics`, `cli/` — all of this was already dotbeat's own, was
never BeatLab code, and is exactly what a new frontend renders/drives. The audio engine
(Tone.js-based) is the clearest lift candidate: BeatLab's `engine.ts` is hundreds of lines of
real, working drum-voice synthesis / sidechain / automation logic (including Phase 10 Stream D's
clip-automation fixes) — porting it into dotbeat's own tree (adapted to dotbeat's own document
shape, MIT-licensed same as this repo so no licensing friction) beats rebuilding it from zero.
Same goes for GUI components: a step-sequencer grid, a knob widget, a transport bar — if BeatLab
already has a working one, port and adapt it rather than starting blank. The line that still
matters is *product design and information architecture* (what screens exist, what the app is
*for*, the teaching-specific chrome) — not "did this line of code originate in the other repo."

**Consequence for in-flight work**: two Phase 11 streams (D4 song view, D5 vary-affordance) were
mid-flight building directly inside BeatLab's React tree when this decision landed; both were
stopped and their beatlab-side output discarded (their PRs, `wgpatrick/beatlab#6` and an
unopened third, are not part of dotbeat's product going forward — they may still be useful to
BeatLab on its own terms, that's the owner's call on that repo). The already-landed clip-automation
engine fix (`wgpatrick/beatlab#5`) stays as-is; it's a bug fix to BeatLab's own correctness,
independent of this decision.

**Revisit when:** never, barring a change of product direction — this is a clean split, not a
temporary one. `docs/product-spec-desktop.md` is being updated to describe dotbeat's own GUI
build rather than a BeatLab wrap.

---

## D11 — New binary media/preset content goes through git-lfs (2026-07-11)

**Decision:** `*.sf2`/`*.sf3`/`*.wav`/`*.h2drumkit` are tracked via `.gitattributes` + git-lfs.
**Update, same day**: the existing pre-LFS blobs *were* migrated after all (`git lfs migrate
import --include="*.sf2,*.wav,*.h2drumkit" --everything`), reversing this entry's original "leave
them as plain objects, that's the owner's call" position. Reason for the reversal: leaving the
repo half-configured (new files LFS-tracked, old files still plain git objects, but a shared
`.gitattributes` rule covering both) turned out to be actively dangerous, not just imperfect — a
concurrent Phase 11 worktree touching those same paths had them silently corrupted down to
133-byte LFS-pointer stubs mid-session (the working-tree file got smudge-converted while the real
object was never migrated into LFS storage to smudge back *from*). Caught immediately via a
sha256 check against each file's own provenance sidecar (`presets/sf2/*.sf2.json`) before it could
propagate anywhere; `main` itself was never touched, verified via `git rev-list --left-right
origin/main...main` (0 behind, migration is purely local — nothing had been pushed yet, so
rewriting commit hashes carried no shared-history risk). Post-migration, every file's sha256 was
re-verified byte-identical to its provenance record and `npm test` stayed at 286/280/0/6.
Delegated per the owner's own "make the small calls yourself" instruction rather than paused on.

**Why:** flagged as an explicitly open question in research 11 ("media/binary versioning at
scale... revisit before D3 ships") and it stopped being hypothetical the moment Phase 10 Stream B
committed two real soundfonts (26MB + 43MB) straight into `.git` — the repo's `.git` directory
is already 47MB and every future sample-content stream (more GM banks, more drum kits, the
still-deferred MuldjordKit per-lane breakdown) adds more binary weight that a plain git history
never sheds. LFS keeps a normal `git clone`/`git log` cheap regardless of how much preset content
accumulates; media is already content-addressed by sha256 at the format layer (D-log, Phase 7),
so nothing about the `.beat` file format itself changes — this is purely a git-storage decision.
`git-lfs` is installed and working on this machine (verified: `git lfs version` → 3.6.1).

**Revisit when:** the owner wants the existing pre-LFS blobs migrated too (needs `git lfs
migrate import`, a history rewrite, done deliberately with the owner's sign-off), or if the repo
gets pushed somewhere with LFS storage/bandwidth limits worth knowing about ahead of time (e.g. a
free-tier GitHub LFS quota).

---

## D10 — Named pins are git tags, not a sidecar file (2026-07-11)

**Decision:** a "pin" (spec §4's named version, e.g. "rough mix v1") is a plain, annotated git
tag in the same local history repo as the checkpoints, namespaced `pin/<slug>` (slug from the
lowercased, hyphenated name) with the exact display name stored in the tag's own message. No new
file format, no JSON sidecar, no metadata that could drift from the repo it describes.

**Why:** the whole point of D3's history design is "no cloud, plain local git, user owns it" (the
Splice Studio lesson, §4) — a sidecar pins.json would be a second thing to keep in sync with the
repo, to lose on a partial copy, and to merge-conflict on if the project folder is ever shared via
a real git remote. A tag has none of those problems: it's a ref in the same repo, travels with
`git clone`/`cp -r` for free, and — because tags are immutable pointers — survives `restore`'s
append-only rewrites automatically (a pinned commit is never deleted, so its tag never dangles).
Considered git notes instead (attaching the name to the commit directly); rejected because notes
don't have their own stable, human-typeable identifier the way a tag name does — listing/removing
"the pin named X" is a `git tag --list`/`git tag -d` one-liner, whereas notes would need a
convention-on-top for the same lookup. The one real limitation: tag names are repo-wide, so two
different `.beat` files sharing one history repo could collide on an identical pin name; current
usage is one project file per repo, so this is accepted for now and callers get a clear "already
exists" error rather than silent corruption if it ever happens.

**Revisit when:** a project folder routinely holds multiple `.beat` files sharing one history
repo and pin-name collisions across files become a real complaint — scope the tag name to the
file at that point (e.g. `pin/<file-slug>/<name-slug>`).

---

## D9 — Canonical elision for optional params; presets are tooling, never grammar (v0.3)

**Decision:** v0.3's ~46 optional synth params are serialized **iff their value differs from a
frozen default**, in fixed table order (`SYNTH_FIELDS` in `src/core/document.ts` — the single
table that drives parser, serializer, `beat set`, semantic diff, and converter). Defaults are
frozen copies of beatlab's `DEFAULT_SYNTH` at freeze time and do NOT track the app. And the
format has no preset reference: `beat preset` applies a named param bundle from
`presets/factory.json` through the same code path as `beat set`, so a preset application is a
readable edit list and an ordinary diff, and every document spells out its own sound in full.

**Why:** always-serializing ~55 params would turn every track into a wall of default noise (the
init patch would go from 9 lines to 55) and make "what did the human/agent actually decide?"
unreadable — elision keeps every present line a deliberate sound decision while preserving
exactly one canonical form per state (D4's round-trip property, unchanged: the elision rule is
deterministic in both directions). Freezing defaults keeps elision a *grammar* property rather
than a live reference to an app version. Preset-as-tooling protects D1 (document-only): an
include/reference mechanism would reintroduce indirection, canonical-form ambiguity, and
"what does this file sound like?" depending on a library version. Trackrefs (`duckSource`) are
banned from preset libraries by construction — routing names project-specific track ids.

**Proven:** Phase 5 exit test (`scripts/verify-phase5.mjs`) — a real 4-track mix reproduced
from pure text with exact per-track engine-state equivalence vs. the hand-patched original.

**Revisit when:** a field's frozen default proves musically wrong at scale (would need a format
version bump, not a silent default change), or preset libraries need versioning/sharing.

---

## D8 — DiffEntry is the one changeset representation (diff display, later undo/--dry-run)

**Decision:** the semantic diff (`src/core/diff.ts`) produces a typed `DiffEntry[]` where every
entry carries `before`/`after` — and this same shape is reserved as the future undo and
`--dry-run` representation, rather than inventing a separate one per feature.

**Why:** openDAW's undo system is an inverse-update-log, not snapshots — a captured
`Modification{forward, inverse}` object *is* a computed diff (`docs/opendaw-notes.md` §7, read
directly from source). Entries that carry both sides are trivially invertible, so diff display,
undo, and preview-before-apply are one data structure with three consumers. Also applied: entity
matching is by stable ID, never position (the `alsdiff` lesson, D4), and the output phrasing is
musical ("note moved", "kick step 3 added"), not textual (the `musicdiff` lesson).

**Revisit when:** undo lands and needs transaction grouping (multiple entries per user gesture) —
grouping metadata may need to join the shape.

---

## D7 — Format syntax resolved: Csound-style lines + Humdrum-style canonical ordering + DAWproject vocabulary

**Decision:** the `.beat` format is a **bespoke line-oriented text format**: typed statement
lines in the spirit of Csound's `.sco` (one event per line, positional fields), a **canonical,
deterministic field ordering** in the spirit of Humdrum `**kern`, and **borrowed field/parameter
names** from DAWproject's XSD schema rather than invented vocabulary.

**Why:** this was an open M0-blocking question (bespoke line-format vs restricted YAML vs TOML)
until `research/04-format-prior-art.md` (fully verified) surfaced real, decades-old precedent:

- Csound `.sco` is confirmed as the closest existing analog to "one event per line, literal
  positional data" — not a novel idea, a 30-year-proven one.
- Humdrum `**kern`'s own specification **explicitly names the diff/version-control problem**
  (equivalent-but-differently-ordered signifiers make `diff`/`cmp` falsely report identical files
  as different) and **prescribes canonical ordering to fix it** — the strongest available
  precedent for treating "one canonical serialization per state" as a hard requirement (see D4)
  rather than a nice-to-have.
- DAWproject's XSD (MIT-licensed, read directly, not just described) gives real, cross-DAW-agreed
  field names for compressor/EQ/clip/automation-point data — no reason to invent our own.
- YAML and JSON both lost on the evidence: YAML has no comparable diff-friendly precedent found
  anywhere in the survey; JSON's trap is demonstrated by openDAW's own `toJSON()` escape hatch,
  which serializes numeric field keys instead of names and is therefore not actually diff-friendly
  despite being "JSON."

**Revisit:** unlikely on the high-level style; exact syntax details still finalized in M0.

---

## D6 — Human-readable slugs over raw UUIDs at the text-serialization boundary

**Decision:** `.beat` entities are identified by short, human-legible slugs (`trk_bass`,
`n_01`) in the text file. UUIDs or content hashes remain canonical internally / for
globally-unique references (e.g. `media/` sample files), but never as the primary text-facing ID.

**Why:** validated independently by two sources found in the same research round —
DAWproject uses `xs:ID`/`xs:IDREF` (human-assignable XML string IDs), and openDAW's own
`AddressIdEncoder` converts its internal random UUIDs into short sequential IDs *specifically* for
its XML export path — i.e. even the project that chose raw UUIDs internally still converts to
short human-facing IDs the moment it needs a text-facing surface. Two independent systems
converging on the same escape hatch is a strong signal. Also matters directly for our agent-native
goal: an AI-authored diff referencing `trk_bass.cutoff` is legible to a human reviewer without a
UUID lookup step; `a3f1e9d2/1/3/20` is not.
*(`docs/opendaw-notes.md` §"do differently" item 3; `research/04-format-prior-art.md` on
DAWproject's `xs:ID`.)*

**Revisit:** unlikely — this is a UX property we want regardless of internal ID scheme.

---

## D1 — Document-only format for v1 (no generator-code layer)

**Decision:** the `.beat` file is **literal data** — every note and knob value stated. No loops,
no functions, no code that generates clips. Deferred: a "generator code" layer that compiles to
documents.

**Why:** the two-layer alternative (code generates the document; GUI edits the document) solves a
real problem but adds real complexity. The killer problem it avoids — *you can't write a GUI edit
back into arbitrary code that generated it* — only exists if there's a code layer. Document-only
sidesteps it entirely and still delivers the whole wish list: git-diffable, CLI-editable,
agent-editable. The code layer can be added later as a one-way generator with an "eject to literal
data on GUI edit" handshake, exactly like flattening an arp clip in a DAW today. **Chosen by the
project owner explicitly.**

**Revisit when:** the document format is proven and users ask for algorithmic composition.

---

## D2 — Metrics-first AI critique (LLM narrates, never judges alone)

**Decision:** the AI-listening loop uses deterministic DSP metrics (LUFS, spectral balance,
masking, crest, stereo width) as ground truth; learned auto-mix models (Diff-MST / DMC) propose
*interpretable parameters*; the LLM only narrates the metric deltas and proposes a diff.

**Why (updated after full verification — the conclusion held, the supporting stats were partly
corrected):** ✅ Confirmed at high confidence: audio-LLMs show severe **text-prior bias**
(barely degrade when audio is replaced with noise), their errors are **dominated by mis-hearing,
not mis-reasoning** (55-64% of errors are perceptual, per MMAU's own error analysis), and they
**cannot produce calibrated numeric judgments** (regression R² at or below the level of guessing
the dataset mean). ⚠️ An earlier version of this rationale cited a "~52% vs 82% human, music is
their weakest domain" headline statistic — **that specific claim was refuted on reverification**
and should not be reused, even though the broader conclusion survives on the claims that did.
**Important epistemic caveat, carried over honestly**: no benchmark has *directly* tested
audio-LLMs on mix-critique tasks specifically (masking detection, frequency-conflict ID,
loudness/dynamics judgment) — this decision rests on a well-evidenced *inference* from adjacent
music-understanding failures, not a direct proof. Strong enough to justify the architecture;
worth remembering it's an inference. *(`research/03-ai-listening.md`, fully verified.)*

**Revisit when:** audio-LLM benchmarks that directly test production/mix-critique judgment appear
(none exist yet, per the research) and show materially better-than-adjacent-task performance.

---

## D3 — Web tier now, Tauri native tier for "not a toy"

**Decision:** ship pure-web for the MIDI/synth DAW; plan a Tauri shell as the pro-audio tier
(native recording latency, plugin hosting, time-stretch). Audio backend swappable behind `engine/`.

**Why (magnitude confirmed, one mechanism claim corrected):** the web platform has a confirmed,
high-confidence latency ceiling — ~30 ms round-trip vs a ~10 ms native target (Soundtrap/W3C
workshop data, 2021; the report flags this figure as now 5 years old and not re-confirmed for
2026). ⚠️ An earlier version of this rationale also cited "`MediaStreamSourceNode` latency is not
exposed anywhere" as the specific mechanism, and separately quoted the WAM-studio authors naming
"the sandbox and latency compensation" as their hardest problems — **both of those specific claims
were refuted on reverification.** The *magnitude* of the gap is solid; the *cause* is not as
pinned-down as previously stated. openDAW is still cited as evidence that synth/MIDI-only web DAWs
are viable — but not by citing its (refuted) specific 2026 roadmap dates; just by the fact that it
ships 27 working devices today. *(`research/02-web-stack-feasibility.md`, fully verified.)*

**Revisit when:** browser audio APIs expose pipeline latency / lower the round-trip floor, or WAM2
plugin ecosystem matures enough to matter.

**Update 2026-07-11 (owner steer):** the product's primary form factor is a **desktop app
connected to local files** — that's what the owner wants to ship, not a hosted web app. This
doesn't change the architecture (the GUI stays web tech; Tauri wraps it), it changes the
*sequencing*: the Tauri shell moves up from "M4, someday" to "as soon as the GUI is worth
wrapping." Everything built so far already assumes local files (the daemon watches a real
directory on disk; media paths are relative to the project folder), so the shell is mostly
packaging plus moving the daemon in-process. The deep M4 work — native audio engine, plugin
hosting, latency — stays M4; the shell doesn't need to wait for it.

---

## D4 — Diff-friendliness is a format *requirement*, not a nice-to-have

**Decision:** stable IDs on every entity, one musical event per line, canonical ordering,
deterministic serialization (round-trip identity tested in CI from M0).

**Why (now with a second, stronger precedent):** REAPER already proves "text file" alone isn't
enough — practitioners git `.rpp` but say git "cannot meaningfully diff or merge" it, because it
lacks stable IDs and canonical form. `alsdiff` proves ID-based matching is workable in practice.
**New**: Humdrum `**kern`'s own spec independently arrived at the same conclusion for musical
notation specifically — canonical ordering isn't optional, it's *the* fix for false diffs (see
D7). Two unrelated domains (DAW projects, musicological encoding) converging on "you must define
one canonical serialization" is strong validation this is foundational, not a nice-to-have.
*(`research/01-landscape.md`, `research/04-format-prior-art.md`, both fully verified.)*

**Revisit:** unlikely — this is foundational.

---

## D5 — Headless Chromium as the reference renderer; node-web-audio-api as an optimization

**Decision:** `beat render` uses headless Chromium first (bit-identical to the browser), adopt
`node-web-audio-api` later for speed, validated against the Chromium reference.

**Why (now with a confirmed exact code recipe):** fidelity beats speed for a v1 render command,
and BeatLab's smoke suite already proves the Chromium path works. `node-web-audio-api` is a
*reimplementation* — divergence is a real risk (Risk #6) that a Chromium reference lets us
measure. ✅ Confirmed at high confidence (previously single-source): Tone.js has first-class
offline rendering (`OfflineContext`/`Tone.Offline()`) built on the standard `OfflineAudioContext`.
The exact Node wiring pattern was confirmed by directly reading `node-web-audio-api`'s own example
file: import the polyfill first, construct `AudioContext` from the polyfilled global,
`Tone.setContext()` before creating nodes, and plan for an explicit `process.exit()` since Tone.js
has no clean Node teardown. *(`research/01-landscape.md` + `docs/opendaw-notes.md`, both
first-party sourced.)*

---

## Open decisions (not yet made)

- ~~**Name**~~ — **DECIDED 2026-07-11 (owner): `dotbeat`.** Named for the format itself (`.beat`) — the file is the product. Local directory and git branch keep their old names until the repo is promoted to its own `dotbeat` repository (still open).
- ~~**License**~~ — **DECIDED 2026-07-10 (owner): MIT.** Consequences, all per verified
  research 07: the GPL engine tier (Surge XT / Vital engines) is CLOSED — no GPL code may be
  ported in; the permissive sound-quality path stays fully open (spessasynth_lib and Dexed's
  msfa DX7 core are Apache-2.0, MIT-compatible); openDAW (AGPL/LGPL) remains
  learn-from-patterns-only, never port-literal-code. LICENSE file added, package.json updated.
- **BeatLab relationship** — hard fork vs BeatLab becomes the "learn" mode sharing a core.
- **Agent placement in the desktop app** — external agent driving via CLI/MCP while the GUI
  live-updates, vs an embedded chat panel, vs a hybrid (embedded panel fronting an external
  agent runtime). Owner deferred to research (2026-07-11); see
  `docs/product-spec-desktop.md` §3 and research 10 when it lands.
- ~~**Web-first vs Tauri-earlier**~~ — **DECIDED 2026-07-11 (owner): desktop-first.** The
  primary form factor is a desktop app connected to local files (Tauri shell around the
  existing web GUI, daemon logic in-process). The browser remains a dev/demo surface, not the
  product. See D3 update.
- **Three confirmed research blind spots**, both surfaced by the fully-verified passes finding
  *zero* surviving evidence despite being explicit original research questions — worth a
  dedicated follow-up before treating adjacent decisions (especially M4 engine choices) as settled:
  1. **Engine architecture** — tracktion_engine, Ardour, Reaper's own write-ups, Zrythm, LMMS.
  2. **Live-coding language comparison** — Strudel, TidalCycles, Sonic Pi, Glicol (GUI-lessness,
     file format, CLI/headless specifics).
  3. **Direct demand-signal/survey evidence** — producers-who-code market signals, forum data on
     which pro-DAW features are make-or-break vs rarely used.

# Design decisions & rationale

A running log of the load-bearing choices, so future-us remembers *why*. Newest at top.

> **Verification status**: all research citations below now point at fully adversarially-verified
> claims (four passes, zero infrastructure errors on the final run) — see
> [`research/README.md`](research/README.md). Where an earlier version of a decision leaned on a
> claim that was later refuted, this is noted explicitly rather than silently fixed.

---

## D22 — offline render is opt-in (`--offline`), exact but not unconditionally fast; live capture stays the default (2026-07-17)

**The decision.** D15's closing note ("if a faster-than-realtime batch render path is needed
later... that's a fresh build bundling `ui/`'s own engine headlessly") is now built —
`ui/src/audio/offline.ts` + `beat render --offline` — as the SAME `Engine` class constructed
inside a Tone `OfflineContext` (one canonical engine survives; this is a second *context*, not a
second engine). It ships **opt-in**, and live capture remains the default and the reference,
because the honest measurement says "offline" and "fast" are not synonyms:

- **Exactness:** offline output is deterministic PCM straight off the graph (identical metrics
  across runs), where live capture rides MediaRecorder→opus→decode. The two parity failures on
  the gate were both cases where *live* is the lossy one: stereo "width" on a mono project
  measures the opus chain's decorrelation noise floor, and a small sub-band share tilt traces to
  low-frequency shedding in the capture chain. Everything else matched inside
  `src/metrics/variance.ts` bounds on both gate projects (2-note smoke, 4-track real-groove).
- **Speed is graph-bound and SUPERLINEAR in song length:** Tone's offline architecture schedules
  the whole song, then renders once; spent one-shot voices can never be disposed mid-schedule
  (their audio hasn't rendered yet), so every note's oscillator+gain survives to the end and the
  render pass processes all of them every quantum. Measured: 1-track smoke 3.4x realtime; the
  8-track 96s `first-light` 0.32x at 10s, 0.12x at 30s — slower than live capture, on a container
  where the live path itself underruns (~0.4x, the Phase-34 wall-clock-truncation evidence). The
  CLI prints the measured ratio and a heads-up whenever it lands under 1x.

**Three t=0/context rules the build surfaced, now load-bearing engine invariants:**
1. **Tick-time code must resolve its transport through the engine's own bound context**
   (`Engine.boundContext`, captured at `ensureStarted`) — never `Tone.getTransport()`/
   `Tone.Time()`. Tone restores the global context *before* offline rendering runs, so a global
   lookup inside a render-time tick answers with the LIVE transport (position 0) — that bug
   retriggered step 0's note on every 16th, forever.
2. **Never schedule the first event at absolute context time 0** — a t=0 attack collides with the
   param's initial-value event and renders a visibly wrong envelope (measured: 10ms attack halved,
   +4 dB resonant overshoot). Offline renders start the transport `OFFLINE_RENDER_PREROLL_SECONDS`
   in and trim exactly that much off.
3. **Drive the render loop synchronously** (`OfflineContext.render(false)`), and suspend the live
   realtime context for the duration: Tone.Offline's async loop yields to `setTimeout` once per
   audio-second, and a hidden headless page's intensive wake-up throttling parks each yield —
   a 96s render stalled indefinitely at ~0% CPU under the wrapper.

**Deliberate v1 scope:** soundfont (instrument/sf-lane) projects are refused loudly (spessasynth
needs a native realtime context); `bitcrushRate` degrades to passthrough with a named caveat;
media is warmed from the live engine's decode caches (`warmMediaLoads` + seeded buffers), never
fetched by the offline instance. The real fix for the superlinear scaling — a schedule-window +
dispose-behind-the-frontier loop over `OfflineAudioContext.suspend()` — is a roadmap item, not a
patch to smuggle in.

## D21 — one batch manifest for generation too; `adopt` learns media, and candidates don't register until they win (2026-07-15)

**The decision.** `beat source gen --count N` (Phase 40 Stream VB) generates N candidates of one
prompt across seeds `S..S+N-1` and rides the **existing** `VaryBatchManifest` into the **existing**
`beat score` / `beat adopt` verbs — no parallel gen-only batch shape, no second scores log, no
`beat gen-adopt`. The three places a gen batch strains that shape are absorbed by **optional fields
on the shape itself**, not by forking it: (a) variants are wavs, so `variants[].file` is `vN.wav`
instead of `vN.beat` — and every reader now resolves the variant through that field rather than
re-deriving `v${n}.beat`; (b) a gen batch has no track, so `track` becomes optional on the manifest
and the score entry, and the round is identified by `group: "gen:<sample-id>"` (plus a top-level
`prompt`, which makes "which prompts/seeds do I actually like" one `jq` over the same
`beat-scores.jsonl` a cutoff sweep writes); (c) `adoptVariant` gains a `media` branch — for a gen
batch, adopt is not a document copy but a **registration**.

**The inversion that makes it worth doing.** Candidates deliberately touch NOTHING until adopt.
`scripts/source-lib.mjs`'s private `ingest()` — prep → sha256 → media-block upsert → enforced
provenance sidecar → rollback — is split at its seam: the **prep half** runs at batch time (once
per candidate, into the batch dir), the **register half** (`registerPreppedMedia`, now in
`src/vary/batch.ts`) runs at adopt time, on the winner alone. Losing candidates leave no trace
outside the batch dir; deleting it forgets them. Two consequences worth stating: the winner is
**copied, never re-prepped** at adopt (prep is not idempotent — it would re-trim and re-fade
already-prepped audio), so the bytes you auditioned are byte-for-byte the bytes that get
registered; and the register half moved into `batch.ts` rather than staying in source-lib because
`adopt` is its second caller and must stay synchronous on both surfaces — source-lib imports it
back, so the single-shot `source add`/`source gen` paths and the deferred `adopt` path share ONE
registration implementation. Splitting `ingest` was meant to defer it, not to fork it.

**Why.** The immediate evidence: building `examples/recipe-song/` on 2026-07-14, the snare was
picked from seeds 5/6/7 by out-of-band FFT measurement — because `beat score`/`beat adopt` require
a manifest generation never produced — and the two LOSING candidates are *still* registered in that
song's media block, with no record that an audition ever happened. Both halves of that are this
decision's targets. The deeper reason for one shape: the manifest/score-log contract was
deliberately unified in Phase 34 NA after pilot 95's cross-surface drift ("extract the shared
shaping into `src/` helpers both surfaces import, so the next drift can't happen"), and a second
batch shape re-forks exactly what that fixed — it would double every reader, and the taste loop's
whole value is that one accumulated log answers "what do I like" across every kind of round.

**Known limit, accepted.** `beat suggest` **ignores** gen entries — its parser drops trackless
entries, so a gen round never enters a track's Bradley-Terry stats. This is the intended reading,
not an oversight: a gen round is not a mutation round for any track, and letting it in would let
`suggest` recommend a nonsense `beat vary <file> <track> gen:snare`. The gen question ("which
prompts/seeds win") is answerable off the same log by `prompt`/`media.seed`, and a real
`suggest`-for-generation is a separate feature with a separate output shape. Revisit if that
feature is ever wanted.

## D19 — the gen sidecar writes the WAV to a told path; TS owns registration + the Stability license posture (2026-07-14)

**The decision (contract variation).** `beat source gen` (Phase 39, Stable Audio Open local
text-to-audio) is the SECOND Python sidecar and reuses the D17 template verbatim — with one
deliberate variation. Analysis emits its whole result as stdout JSON and writes no files; generation
produces **binary audio**, so `python/gen.py` **writes the generated WAV to the `--output` path it
is told** and prints only a small JSON **metadata** doc (`{backend, provider, model, seconds, seed,
sampleRate}`) on stdout (chatter → stderr). Everything else is identical: stdlib-only top level with
lazy backend imports (`stable_audio_tools`, `torch`), the `0/2/3/4` exit codes with a copy-pasteable
`pip install -r python/requirements-stableaudio.txt` as the last stderr line on a missing dep, the
`$BEAT_PYTHON` → `python/.venv` → `python3` resolution, and a `--doctor` probe via
`importlib.util.find_spec`. The TypeScript/`scripts/source-lib.mjs` side owns ALL of registration:
`addGeneratedSource` generates to a temp `media/.<id>.gen.wav`, then routes through the existing
private `ingest()` tail, so prep (normalize/sha256/duration), media registration, the ENFORCED
provenance sidecar `media/<id>.wav.json` (recording prompt/provider/model/seconds/seed under
`generated`), and rollback-on-failure all come for free — the temp file is removed in a `finally`. A
stdlib-only `stub` backend writes a deterministic seed-derived tone bed so CI/the dev container
exercise the whole pipeline with zero packages.

**Why.** Gen can't fit analyze's stdout-only rule (a WAV isn't a JSON line), but keeping the Python
side dumb — "write bytes here, print metadata" — preserves D17's core property: everything
dotbeat-specific (provenance, media block, rollback) stays in testable TypeScript, and the Python
surface is tiny and swappable. Reusing `ingest()` rather than a parallel registration path means the
generative provenance record is the same shape as RD's Freesound one.

**The license posture (Stability AI Community License, research 103).** Stable Audio Open 1.0 is the
one licensing-clean, egress-free generative path for dotbeat's shareable-project thesis. You **own**
the generated outputs; commercial use is free for individuals/orgs under **$1M annual revenue**
provided you register a Community License with Stability (it terminates above $1M → Enterprise). The
license's distribution/attribution obligations (ship a copy of the license, display **"Powered by
Stability AI"**) attach to redistributing the **model/Materials/derivatives**, NOT to the individual
generated output `.wav` files — so committing generated one-shots into a public `.beat` project's
`media/` folder is clean. dotbeat carries the "Powered by Stability AI" attribution in its docs
(`python/README.md`) as the tool-integration obligation; per-output files need no attribution. The
HF weights repo id (`stabilityai/stable-audio-open-1.0`) and the `stable-audio-tools` version pin
are placeholders to confirm owner-side (HF/PyPI unreachable from the build container).

## D18 — a reference track analyzed for structure never enters the project as media (2026-07-14)

**The decision.** `beat analyze <song.wav>` (Phase 38) reads a reference track and emits a
`*.analysis.json` of numbers and labels (tempo, beat/downbeat times, section boundaries) — and the
source audio is **never registered into the `.beat` project** as a media clip. `beat skeleton`
scaffolds an empty structure-matched project from that JSON; the JSON path is the only trail back
to the reference. There is deliberately no `--register-source` shortcut.

**Why.** Research 102's copyright posture: an analysis artifact that is purely derived facts
(BPM, section labels) is safe to commit, diff, and share; the analyzed audio itself is someone
else's copyrighted recording and has no business living inside a user's MIT-licensed project. Keeping
the two apart at the tool boundary makes the safe thing the default and the unsafe thing something a
user has to do on purpose (they still can, explicitly, via `beat source add` with their own file and
an asserted license). This mirrors D-series "make the canonical/safe form the path of least
resistance" reasoning.

## D17 — the Python-sidecar JSON contract: TS owns all I/O and unit conversion, Python emits raw analysis in seconds (2026-07-14)

**The decision.** dotbeat's first non-Node dependency (Phase 38 audio analysis) is structured as a
**child-process sidecar with a frozen JSON contract**, not an embedded runtime or an FFI binding.
`python/analyze.py` imports stdlib only at module top (backend deps — torch, beat_this, allin1 —
import lazily inside their run functions), takes `--backend`/`--input` (or `--doctor`), and writes
the analysis **core** (`{backend, bpm|null, beats, downbeats, sections}`, all times in **seconds**)
to **stdout only** — no file writes, no dotbeat knowledge. The TypeScript wrapper
(`src/analysis/sidecar.ts`) owns everything else: it computes the audio sha256, resolves the Python
interpreter (`$BEAT_PYTHON` → `python/.venv/bin/python3` → PATH), enforces the exit-code contract
(0 ok · 2 bad input · 3 missing dep · 4 failure) with copy-pasteable degrade messages, wraps the
core in the versioned envelope, and atomically caches it next to the audio. All **seconds→bars**
math and the canonical `AnalysisArtifact` validation live on the TS side (`src/analysis/import.ts`),
which is the sole validation authority. A stdlib-only `stub` backend produces a deterministic grid
so CI and dev containers exercise the identical plumbing with zero Python packages installed.

**Why.** (1) The MIR ecosystem is Python/PyTorch (research 102) — a sidecar is the only realistic
shape, and a frozen JSON boundary keeps that dependency at arm's length: everything dotbeat-specific
stays testable in TypeScript. (2) Putting sha256/caching/unit-conversion/validation on the TS side
means the Python surface is tiny, dumb, and swappable — a future backend (allin1, or `gen.py` for
Stable Audio Open in Phase 39) copies the same argv/exit/doctor conventions at near-zero cost. (3)
The `stub` backend + skip-gated integration tests keep the suite green everywhere, including the CI
and dev environments where PyPI/HuggingFace egress is blocked and torch can never install — real
models run only on the owner's machine, validated via `beat analyze --doctor`. The conventions are
documented in `python/README.md` as the shared template for later sidecars.

## D16 — multi-region audio placement: repeated `slot` lines with `at <steps>` (2026-07-14, owner)

**The decision.** Lift the one-clip-per-track-per-scene ceiling via Option A of
`docs/multi-region-audio-design.md`: a scene may carry MULTIPLE `slot` lines per track, each an
independent placement with an optional trailing `at <steps>` (fractional 16th steps from the
section start; `at 0` is elided so every existing file round-trips byte-identically). Owner
approved all three open questions as recommended: (1) Option A over a separate `place` statement
(one grammar, one canonical form — D4) and over an absolute-time arrangement lane (a second
timing system with no current user; revisit at M4, Option A doesn't foreclose it); (2) the unit
is 16th steps, matching note/hit starts and `audio-split` positions — one time vocabulary
everywhere; (3) `beat audio-split` auto-places the second half at the split point in every scene
that placed the original, which retroactively kills the orphaned-split bug class.

**Scope guard.** v1 validation restricts `at > 0` / multiple placements to audio tracks —
synth/drum clips at an offset would silently play wrong today, and fail-loudly beats
silently-wrong (the same reasoning that rejected accept-and-ignore). Lifting that later is a
validation+engine change with zero grammar churn. Placements sorted by `at` (ties: clip id);
overlapping placements on one track are a validation ERROR (Ableton's no-overlap rule).
Same clip placeable twice — placements are references. Format bump: v0.11.

**Revisit when:** M4 recording/comping forces absolute-time thinking (Option C's arrangement
lane can then coexist; placements migrate mechanically), or when a real need appears for
synth/drum multi-placement (lift the validation, teach the engine).

---

## D15 — one canonical audio engine: `ui/src/audio/engine.ts`; both CLI render paths retarget to it (2026-07-11)

**The problem, precisely.** Four things currently produce audio from a `.beat` file, and they are
not four equally-valid options — they're one architectural smell plus one real duplication:

1. **`cli/render.mjs`** — headless Chromium driving BeatLab's *own* live engine. Hard-requires
   `--beatlab-dir`/`BEATLAB_DIR`: a separate repo checkout on disk.
2. **`cli/render-offline.mjs`** — `scripts/build-headless-engine.mjs` bundles BeatLab's *own*
   engine+store headlessly, run via `node-web-audio-api`'s polyfill instead of a browser. Also
   hard-requires a BeatLab checkout, **and** needs a locally-patched `node-web-audio-api` build
   (the plain npm release explodes on FM-through-zero hi-hats) that isn't present on this machine
   — confirmed this session (Phase 12 Stream 2) to render **total silence** in this environment,
   not a degraded result, a silent no-op.
3. **`ui/src/audio/engine.ts`** — dotbeat's own hand-ported, hand-adapted copy of BeatLab's
   engine, now full parity (Phase 13 Stream A) and the only one of the four that's actually
   *dotbeat's own code*, in this repo, driving the actual product (the live GUI).
4. **BeatLab's own live engine**, in the separate `wgpatrick/beatlab` repo — the ancestral source
   #3 was ported from, still what BeatLab's own app runs, no longer anything dotbeat's product
   renders through directly (D12 ended that relationship at the product level) but still what
   *paths 1 and 2 secretly depend on*.

So it's not "four independent engines to unify" — it's **one real engine dotbeat owns (#3), one
real engine BeatLab owns (#4) that dotbeat has no business still depending on post-D12, and two
CLI entry points (#1, #2) that reach across the D12 fork line to use BeatLab's instead of
dotbeat's own.** That dependency is the actual bug: every one of tonight's engine-parity
verifications (Phase 13 Stream A's metric comparisons, Phase 14's mute/solo and instrument-track
checks) already treats `ui/`'s engine as the reference-worthy one — the CLI paths pointing at
BeatLab instead are now testing the wrong thing, and #2 is outright broken.

**Decision:** `ui/src/audio/engine.ts` is the one canonical engine. `cli/render.mjs` gets
retargeted to drive dotbeat's own `ui/` (headless Chromium against a locally-served build of
`ui/`, the same pattern `ui/verify*.mjs` already uses — no BeatLab checkout involved at all).
`cli/render-offline.mjs` — silently broken, dependent on an unpatched external library *and* an
external repo — is retired rather than repaired-in-place; if a faster-than-realtime batch render
path is needed later (it matters for `beat vary`/`beat score` batch throughput), that's a fresh
build bundling `ui/`'s own engine headlessly, not a fix to code that reaches into BeatLab.
`scripts/build-headless-engine.mjs` and its BeatLab-checkout dependency retire with it.

**Why now, not later:** the owner's own words this session — "that seems like something that
definitely needs to be resolved... let's figure this out quickly... sounds like a priority."
Correct call: every stream about to touch the engine (FX arsenal, audio-clip editing for M4)
would otherwise have to pick which of two divergent engines to extend, and Phase 12-14 already
implicitly answered that question in `ui/`'s favor without anyone writing it down.

**Revisit when:** never for #1/#2's BeatLab dependency (that's just wrong now, not a tradeoff) —
only revisit whether a *second, faster* render harness for dotbeat's own engine is worth building,
once real usage shows CLI render speed is actually a bottleneck.

---

## D14 — BYO-Claude-Code is the agent surface for now, not an embedded chat panel (2026-07-11)

**Decision:** the "agent placement" question `docs/product-spec-desktop.md` §3 left open (owner
sign-off explicitly pending after research 10) is resolved as **option A**: an external agent
(Claude Code today) runs beside the app and drives it over `beat mcp`. No embedded chat panel is
being built right now. Concretely, this means investing in *making the external-agent path
excellent* — starting with a Claude Code **skill** that teaches it dotbeat's CLI/MCP surface well
(project layout, the edit-primitive vocabulary, `beat vary`/`--scope selection`, how to read a
`beat diff`) — rather than building UI-embedded agent chrome.

**Why:** matches research 10's own "option A is the correct interim" verdict, and the owner's
explicit steer this session: "we'll operate in Claude Code to interface with the CLI/MCP." The
two-tier hybrid (inline affordance + full embedded panel, research 10 §3) remains the
research-backed long-run answer, but building it now would mean owning prompt/agent-loop/keys/
billing before the BYO path has even been given a real skill/tooling investment to prove out.

**Revisit when:** the BYO-Claude-Code + skill path has real usage behind it and a concrete gap
only an embedded panel can close shows up — not before.

---

## D13 — distribution stays local-machine-only; no notarization/signing work for now (2026-07-11)

**Decision:** the Mac app targets *this machine, this owner* for the foreseeable near-term. No
Apple Developer Program enrollment, no notarization, no code-signing beyond the default ad-hoc/
linker-signed debug build, no Windows/Linux builds.

**Why:** owner's explicit call this session. Phase 13 Stream D already scoped the packaged app
this way pragmatically (`docs/phase-9-tauri-spike-plan.md`'s dated addendum); this makes it
official rather than an implicit default that a future session might second-guess or "fix"
unprompted.

**Revisit when:** the owner decides to put the app in front of anyone other than himself — at
which point research area 2 in the 2026-07-11 project review (real notarization requirements
without a pre-existing paid Developer Program commitment) becomes live work, not background
reading.

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

**Second update (2026-07-11, at push time)**: the `git lfs migrate import --everything` above
rewrote **every commit hash in local `main`'s history**, not just the ones touching binary
files — `migrate` rewrites the whole chain because each commit's parent pointer changes once any
ancestor's content changes. This wasn't consequential while everything stayed local, but it meant
local `main` and `origin/main` no longer shared a common ancestor by the time this session pushed.
Pushed by squashing local `main`'s current tree onto a fresh commit built directly on the real,
unrewritten `origin/main` (`git read-tree --reset -u main` on a branch checked out from
`origin/main`, then one commit, then a clean fast-forward push) — origin's own pre-existing
history was never touched or force-rewritten. The detailed, phase-by-phase local history stays
intact on `main` and on `backup-pre-push-2026-07-11`; only `origin/main` sees a single squash
commit for tonight's work. **Practical consequence for future sessions**: local `main` and
`origin/main` will look like they've "diverged" by commit count — they haven't in content, this is
expected, and the same squash technique is the safe way to push again next time (or a deliberate,
owner-approved force-push if full commit-level parity with origin is ever wanted instead).

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
- ~~**BeatLab relationship**~~ — **DECIDED 2026-07-11 (owner): hard fork** at the product-design
  level; code-lifting stays fair game. See D12.
- ~~**Agent placement in the desktop app**~~ — **DECIDED 2026-07-11 (owner): BYO-Claude-Code
  (external agent over `beat mcp`), not an embedded chat panel, for now.** See D14.
- ~~**Web-first vs Tauri-earlier**~~ — **DECIDED 2026-07-11 (owner): desktop-first.** The
  primary form factor is a desktop app connected to local files (Tauri shell around dotbeat's
  own GUI, daemon logic in-process). The browser remains a dev/demo surface, not the
  product. See D3 update.
- ~~**Distribution scope**~~ — **DECIDED 2026-07-11 (owner): local-machine-only.** See D13.
- **Three confirmed research blind spots**, both surfaced by the fully-verified passes finding
  *zero* surviving evidence despite being explicit original research questions — worth a
  dedicated follow-up before treating adjacent decisions (especially M4 engine choices) as settled:
  1. **Engine architecture** — tracktion_engine, Ardour, Reaper's own write-ups, Zrythm, LMMS.
  2. **Live-coding language comparison** — Strudel, TidalCycles, Sonic Pi, Glicol (GUI-lessness,
     file format, CLI/headless specifics).
  3. **Direct demand-signal/survey evidence** — producers-who-code market signals, forum data on
     which pro-DAW features are make-or-break vs rarely used.

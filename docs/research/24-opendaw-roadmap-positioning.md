# openDAW: roadmap, demand signal, and positioning — competitive research

> **Scope note**: unlike `docs/opendaw-notes.md` (architecture/format archaeology), this pass is
> about *vision and demand*: what openDAW's own team prioritizes next, what real users ask for,
> what breaks in practice, and how the product is positioned. Sources: the shallow clone at
> `/private/tmp/dotbeat-scratch2/opendaw` (commit `de7565a`, cloned 2026-07-11) plus live GitHub
> API queries (`gh api`) against `andremichelle/openDAW` and a fetch of `opendaw.studio`.

> **⚠️ License note**: openDAW is AGPL v3 / LGPL-3.0-or-later. Everything below is facts, feature
> names, and ideas — not copyrightable, safe to describe and recommend. Never port verbatim
> source or marketing copy; reimplement from the idea, not the code.

> **A note on this clone's contents**: the task brief pointed at `future-plans/`, `announcements/`,
> `errors/`, and `CLAUDE.md`, but the clone turns out to contain a much larger internal archive at
> `plans/` (60+ feature-design docs), `plans/issues/` (a doability-rated plan for every one of the
> 55 open GitHub issues as of 2026-07-08), and `docs/live-collab-*.md` (3 files on their real-time
> collaboration engine). These are read below too since they're the single richest roadmap signal
> in the repo — skipping them would have missed the most important finding (§4).

---

## 1. What openDAW's own team prioritizes next

**Official roadmap** (`README.md:138-166`, "Roadmap" section — dated, most is already checked off):

| Quarter | Item | Status |
|---|---|---|
| 2025/Q4 | Preset API | ✅ done |
| 2025/Q4 | Cloud services (samples/projects/presets) | ✅ done |
| 2025/Q4 | Playback algorithms (pitch, stretch, absolute, interpolation) | ✅ done |
| 2026/Q1 | Fade-in/out on audio regions | ✅ done |
| 2026/Q1 | Signature + tempo automation tracks | ✅ done |
| 2026/Q1 | Fine-tune recording, incl. loops/takes | ✅ done |
| 2026/Q2 | WASM audio engine | ✅ done |
| 2026/Q2 | Polish UI | ⬜ open |
| 2026/Q3 | Testing & QA | ⬜ open |
| 2026/Q3 | **Launch 1.0** (`https://opendaw.org/release26/`) | ⬜ open |

So the *public* framing is: openDAW considers its feature set essentially complete going into
mid-2026 and is now in a UI-polish/QA/launch runway toward "1.0." That reads as a maturing,
close-to-shipping product, not an early-stage one.

**But the internal `plans/` archive tells a different, much bigger story.** It contains
60+ substantial internal design docs for work well beyond the public roadmap, e.g.
`nam-integration.md` (Neural Amp Modeler — import real guitar-amp/pedal ML models), `vocoder.md`,
`apparat.md`/`apparat-tb-303.md` (new synth instruments), `tone-3000-api.md` (third-party
tone/preset marketplace integration), `compact-soundfont.md`, `code-fx.md` (a scriptable/code
effect — "Werkstatt"), `preset-device-browser.md`, `preset-folders.md`, `templates.md` (see §4),
`pwa.md`, `dashboard.md` (a public stats dashboard — see below), and three files specifically on
**live collaboration** (`docs/live-collab-*.md` — the single most important finding, §4).

`plans/issues/README.md` is a meta-artifact worth noting on its own: it's a **doability-rated plan
for all 55 open GitHub issues** as of 2026-07-08 (1–5 scale, 5 = ship in a sitting, 1 = needs new
architecture), each with its own file (`_TEMPLATE.md` format: what's asked, current behavior with
real `path:line` refs, a plan, risks). This is the team using an AI agent (their own `CLAUDE.md`
confirms Claude Code is the daily tool) to systematically pre-triage their entire open-issue
backlog into actionable specs *before* a human picks one up — a genuinely interesting **process**
idea, not a feature: an agent that turns "user complaint" into "scoped, doability-rated plan with
file:line citations" as a standing background job. Worth stealing as a *workflow*, not a product
feature (see §5).

Their own cross-issue synthesis (`plans/issues/README.md:87-96`) groups the 55 issues into
**three recurring architecture-gap themes**, i.e. what's actually blocking the most requests:
- **Automation node interaction** (7 issues) — one subsystem, needs sequencing (fix grid-snap
  first, other UX bugs build on it).
- **Playfield generalization** (3 issues) — their sample-trigger grid only fully works for one
  content type; several requests want it generalized.
- **Modulation / parameter routing** (5 issues, tier-1 "foundational") — no free
  modulation-routing layer exists yet; building one would subsume mono/legato/portamento (#42),
  separate envelopes (#149), multitarget automation (#89), and effect-enable automation (#270) all
  at once. This is their single highest-leverage missing subsystem by their own accounting.

**Two smaller, concrete future-plans** (`future-plans/`, as flagged in the task):
- `scroll-driven-scrollbars.md` — a CSS `animation-timeline: scroll()` compositor-synced scrollbar
  upgrade, explicitly **deferred** because Safari has no stable support as of mid-2026 (cross-browser
  Baseline gating a real UX polish item — a useful discipline: don't ship a Chromium-only
  enhancement without a fallback).
- `wasm-simultaneous-note-ordering.md` — a real TS-vs-WASM engine parity bug: simultaneous-ending
  chord notes release in a different order between the two engines (`sort_unstable_by` on
  `(offset, rank)` ties is unspecified), causing mono/glide-back to diverge. Interesting as a
  concrete example of the "two engines must agree" tax openDAW pays for shipping both a TS and a
  Rust/WASM engine — a cost dotbeat's single-engine architecture avoids (per `docs/opendaw-notes.md`
  §2/§9, already noted as a design lesson).

`future-plans/nextcloud.md` + `future-plans/nextcloud-app.md`: covered by a parallel research
stream per the task brief; noted here only as confirmation they exist and describe a
school-Nextcloud storage/provisioning integration (see §4 education positioning).

---

## 2. What real users seem to want most (GitHub issues/discussions)

**⚠️ Popularity-signal caveat**: this repo's issue "+1" reaction counts and comment counts are
low in absolute terms (max reactions seen: 2; max comments on an open issue: 9) — a small,
engaged community, not a statistically loud signal. Treat rankings below as *directional*, not
proof of mass demand. Cited with issue numbers so they're independently checkable
(`gh api repos/andremichelle/openDAW/issues/<n>`).

Repo stats (`gh api repos/andremichelle/openDAW`, live 2026-07-11): 1,883 stars, 55 open issues,
Discussions enabled.

**Most-discussed open issues** (by comment count, `gh api .../issues?sort=comments`):
- **#201 "classic time stretch"** (9 comments, open) — user wants a second time-stretch mode
  (repeat-with-forward-moving-transient, classic granular) alongside the existing algorithm, plus
  tempo-synced/off-sync rate control. Rated doability 3 in the internal plan ("extends voice
  architecture, new timing model").
- **#73 "Mousewheel zoom-in bug"** (7 comments, open) — `deltaMode` line-vs-pixel handling bug,
  rated doability 4 ("mechanical").
- **#203 "Analyser Device"** (6 comments, open) — wants a visual spectrum/level analyser device;
  doability 3 (FFT infra exists, 4 new visualizations needed).
- **#207 "custom device inputs"** (4 comments, open) — XY pad / pulse-style custom controllers;
  doability 2 ("pulse has no backing box-graph concept" — real gap).
- **#29 "Region Resize Tool Behaviour"** (5 comments, open) — resize-tool UX inconsistency,
  doability 3.

**Notable closed/resolved requests that reveal what users actually hit** (title + gist, all via
`gh api .../issues/<n>`):
- **#151 "deleting an instrument track does not delete its child tracks"** — deleting an
  instrument left its automation tracks and device panel orphaned/dangling. A referential-integrity
  bug in exactly the area openDAW's own box-graph model is supposed to guarantee (cascade delete) —
  a real-world crack in the "deleting a box cascades through its dependency graph automatically"
  claim from `docs/opendaw-notes.md` §1.
- **#276 "opendaw full data export"** — user wants to export *all* local projects/presets at once
  because "the browser sometimes randomly clears the cache." A browser-storage-as-source-of-truth
  tax: users don't trust OPFS/IndexedDB to keep their work, so they want an escape hatch to real
  files. **Directly validates dotbeat's local-file-on-disk model** — this is a problem dotbeat's
  git-native text file on the actual filesystem structurally cannot have.
- **#110 "Volume automation on regions (fade-in/fade-out)"** — closed/shipped; concrete UX spec
  worth noting: two draggable fade handles from the region edges, crossing = min of both, stored
  as **normalized 0..1 region-relative values**, snap-to-grid. Small, clean, reusable field
  vocabulary if dotbeat adds region-level fades.
- **#244 "Quantize Notes API request"** — a real user filing an *API ergonomics* bug: their
  scripting API's `quantiseNotes` only accepted a whole `NoteEventCollectionBox`, not an array of
  individual notes or a selection, and didn't support offsetting to a global grid when a clip
  starts off-beat. Signal that openDAW users script against it — worth reading as adjacent
  evidence that "programmatic/scriptable DAW access" (openDAW's `Werkstatt`/code-FX system) has
  organic pull, independent of any AI-agent framing (openDAW's own scripting is closer to a
  built-in macro language than an agent surface — see §4).
- **#42 "Set polyphony limit per instrument"** (mono/legato/portamento) and **#149 "separate
  vol/filter envelopes"** — both closed as duplicates of the deeper missing "modulation layer"
  theme (§1).
- **#226 "Lightweight Presets"** — user wants a dead-simple flat `{"Param1": "0.1", ...}` JSON
  preset format (skip unknown/extra params, clamp invalid values) *specifically to share settings
  with other people* — a plain-text, sharable, diffable format is something users ask for even in
  a project whose native format is opaque binary. Corroborates dotbeat's format thesis from the
  demand side, not just the architecture side.
- **#6 "Modular Skins"** — explicitly "way into the future," references Surge synth's
  skinning system (`surge-synthesizer/surge#8061`) as prior art. Low-priority but shows users
  associate an open, hackable DAW with visual customizability.
- **#290 "Recording silently drops audio in hidden tabs"** — a sharp, well-diagnosed bug report
  (not a feature ask): Chrome throttles the main-thread poll loop that drains the recording ring
  buffer to ~1/sec (then ~1/min after 5 min) when a tab is hidden, but the ring buffer only holds
  ~0.37s, so most of a take is silently lost if the user alt-tabs mid-recording. **A browser-tab
  lifecycle problem that is structurally impossible in a local-machine app** (no background-tab
  throttling for a desktop process) — direct evidence for the "browser DAW" tax, relevant to
  dotbeat's Tauri desktop-app positioning (D3, D13).

**GitHub Discussions** (`Ideas` category, low volume — 8 discussions total in the sample pulled):
the standout is **discussion #218, "openDIAW.be"**, a real community **fork** adding AI features:
9 new instruments (Drone, Grain, Glitch, Circus, Honk, Magenta, AceStep, KokoroTTS, Piper) plus an
"AI Bridge" server proxying 17 audio backends (TTS, AI music generation, stem separation) via
Ollama/ACE-Step/Kokoro/ffmpeg. This is the clearest available evidence of organic "AI + DAW" demand
in openDAW's own community — but note **what kind** of AI it is: AI as a *sound-generation source*
(instruments that synthesize/generate audio content), not AI as an *agent that drives the DAW's
structure* via files/CLI. That's a materially different axis from dotbeat's agent-native
positioning — see §4.
Other discussions are low-signal (#4 "Support Web Audio Modules," closed `wontfix`; #217 "Nix dev
environment"; a few Q&A threads on MIDI import / manuals — none indicate a strong unmet need).

---

## 3. The error/fragility pattern — what's actually hard about a browser DAW

`errors/error-triage.md` is a maintained index (snapshot of `logs.opendaw.studio`, 2026-07-05)
against real production error telemetry, with a deliberately honest status convention: **"Nothing
is marked RESOLVED... a silenced/reworded panic is not a fix."** Two prior "RESOLVED" entries were
downgraded back to OPEN when the team realized the fix was cosmetic (a panic reworded to
`console.error`, not actually prevented). That rigor (don't let error-suppression pass as a fix)
is itself a good practice to note, independent of the DAW-specific content.

Reading across the ~30 error files, four **fragility clusters** emerge — a fair proxy for "what's
structurally hard about a browser-based DAW," useful context for what dotbeat's local-machine
architecture avoids or must independently solve:

1. **Browser storage is not a reliable disk.** `ENV-storage-quota-exceeded.md` (OPFS write hits
   quota mid-save, 5 occurrences), `ENV-storage-file-not-found.md`, `ENV-storage-io-read-failed.md`,
   `ENV-storage-not-available.md` (a Worker context has no graceful OPFS-unavailable path),
   `ENV-storage-transient-cached-state.md`. All required explicit `tryCatch` + friendly-dialog
   wrapping around every OPFS/IndexedDB write path — work a real filesystem write doesn't need.
   **This entire cluster is structurally avoided by dotbeat's actual-file-on-disk model** — it's
   the single clearest "the browser tax is real" data point in the whole archive, and it's the
   same lesson as GitHub issue #276 (§2) from the user side.

2. **Numeric/precision boundary bugs in the timeline.** `P1-timeline-duration-family.md` is the
   single most-worked error group (7 occurrences across 3+ months, REOPENED twice as of
   2026-07-05). Root cause: seconds-based audio regions carry genuinely fractional ppqn values
   (not an integer grid), so float64→float32 storage plus exact boundary comparisons
   (`region.complete <= complete`) occasionally truncates a sub-ulp remainder to exactly 0.0
   duration, which a post-commit invariant validator then panics on. The fix (`boundaryTolerance =
   |value|·2⁻²³ + 1e-3`, a magnitude-aware float32-ulp tolerance) is a genuinely subtle numerical
   correctness lesson: **any timeline representation that mixes an integer musical grid (ppqn)
   with continuous real-world time (seconds-based audio) needs boundary-tolerant comparisons, not
   exact ones, wherever edits can land arbitrarily close to a boundary.** Directly relevant if
   dotbeat's format ever represents audio-region boundaries in fractional-beat terms alongside
   whole-tick note positions.

3. **Graph/undo integrity under concurrent or interrupted operations.**
   `P2-undo-rollback-pointerfield-missing.md`, `P2-box-graph-already-staged.md`,
   `P2-box-graph-requires-an-edge.md`, `P2-device-delete-no-device-host.md` — all cases where the
   typed box-graph's own referential invariants (mandatory pointers, exclusive targets) got
   violated by an undo rollback, an abort, or a delete racing another operation. This is the same
   invariant system stressed much harder by live collaboration (§4) — the errors are a preview of
   why deterministic reconciliation became necessary.

4. **Third-party/environmental noise treated as fatal by default.** A cross-cutting fix noted at
   the top of `error-triage.md`: their `ErrorHandler.processError` used to treat **any** unhandled
   promise rejection as fatal (killed the whole session with a recovery dialog), even a
   reason-less one — this was the root cause behind a large fraction of the "crash" class
   (`ENV-network-failed-to-fetch.md`, `ENV-network-chunk-load.md`, `ENV-generic-unhandledrejection.md`,
   Monaco editor worker errors, file-picker permission denials). The generalizable lesson: **triage
   promise rejections as recoverable-by-default, and reserve session-fatal handling for genuinely
   synchronous errors** — a cheap, high-leverage error-handling policy any app with async I/O
   should adopt regardless of platform.

Resource-exhaustion is its own smaller cluster: `P3-mixdown-offline-render-oom.md` — exporting a
long/many-stem mixdown can `RangeError: Array buffer allocation failed` on the single contiguous
`ArrayBuffer` a WAV encode needs (`44 + frames × channels × 4` bytes). The proposed fix is
pre-checking projected byte size and failing with a friendly "Render Too Large" message rather than
attempting a doomed allocation — a real constraint for any renderer that materializes a whole
buffer at once, worth keeping in mind for dotbeat's own `beat render` on very long projects.

---

## 4. Positioning: openDAW today vs. where dotbeat can differentiate

**openDAW's actual self-positioning** (`README.md`, live and stable — the earlier WebFetch of
`opendaw.studio` returned only the SPA's header shell since it's a JS app, so the README is the
more reliable source of their own words):

> "openDAW is a next-generation web-based Digital Audio Workstation (DAW) designed to
> **democratize** music production and to **resurface the process of making music** by making
> **high-quality** creation tools accessible to everyone, with a strong focus on **education** and
> **data-privacy**."

Concrete pillars, all explicit in the README:
- **"No SignUp, No Tracking, No Cookie Banners, No User Profiling, No Terms & Conditions, No Ads,
  No Paywalls"** — a privacy/anti-SaaS stance, unusual and clearly deliberate branding.
- **Education first.** The `announcements/` folder (real, shipped marketing copy) is *entirely*
  framed around classrooms: the Templates feature announcement's LinkedIn/newsletter copy leads
  with "why it matters for education... a teacher can prepare a template... every new project can
  start from that template instead of an empty page, so the class begins from the same setup."
  `announcements/DECISIONS.txt` confirms this isn't incidental: *"Newsletter: focus on the schools
  angle"* is a standing style rule. The unread-per-brief `future-plans/nextcloud*.md` files
  reinforce it (per-student Nextcloud accounts, classroom provisioning, "audience: schools and
  music classes first").
- **Free/open, browser-based, zero-install.** Positioned against paid/installed DAWs on
  accessibility grounds, not on power-user grounds.
- **Live collaboration is a real, actively-engineered feature**, not a marketing line. The three
  `docs/live-collab-*.md` files describe a genuinely hard, half-finished distributed-systems
  problem: openDAW syncs the box-graph over a Yjs CRDT (`YSync.ts`), but Yjs only guarantees
  document convergence, not the box-graph's own referential invariants (mandatory pointers must
  resolve, exclusive targets accept at most one incoming edge, no cycles). Their prior fix
  (revert the whole batch locally on a validation failure) caused **silent peer forking** — each
  client reverting to a *different* local state, so a "live room" could end up with participants
  silently editing divergent projects with no way to detect it. The fix in progress
  (`live-collab-deterministic-reconcile.md`) is a pure, order-independent repair function
  `G = f(D)` applied identically on every client so all peers re-derive the same legal graph from
  the same raw (possibly-illegal) document — verified with a 12-seed randomized multi-peer fuzz
  test. `live-collab-conflict-resolve.md` catalogs ~10 more known edge cases still open (P1: sync
  doesn't validate on room-join; stale rollback subscriptions; double-notification bugs).
  **This is real, hard, unfinished work** — and it's the single clearest example in this whole
  archive of the cost of the feature dotbeat has explicitly opted out of (per `ROADMAP.md` §1: "no
  live collab"). Every one of these bugs is a direct consequence of *choosing* live multi-user
  editing; a single-user, git-checkpoint-based model (dotbeat's actual design, D10) sidesteps the
  entire problem class by construction, in exchange for git's own well-understood
  branch/merge/PR workflow instead of real-time CRDT reconciliation.

**Where openDAW's AI angle sits today**: essentially nowhere in the *product*. The only concrete
AI-adjacent evidence found is (a) `plans/nam-integration.md` — importing Neural Amp Modeler ML
models for guitar/pedal tone matching, i.e. AI as a *DSP algorithm inside a device*, and (b) the
community fork `openDIAW.be` (discussion #218, §2) — AI as a *content-generation source*
(TTS/AI-music instruments via an external bridge server). Neither is "an AI agent inspects, edits,
or scripts the project structurally." Their own internal engineering practice *does* lean on
Claude Code heavily (`CLAUDE.md`'s coding-style rules, `plans/issues/README.md`'s
agent-generated per-issue triage, `docs/validate-claude.md` existing at all) — but that's the
*team* using an agent to build the product, not the *product* exposing agent access to end users.

**The gap this confirms for dotbeat**: dotbeat's "GUI + diff-friendly git-native text +
CLI/MCP agent access" thesis (`ROADMAP.md` §1) is not just unaddressed by openDAW — it's a
genuinely different axis from every AI signal found in openDAW's own ecosystem. openDAW's
closest AI moves are "AI generates the *sound*" (NAM, openDIAW.be); dotbeat's is "AI edits the
*project*, musically and structurally, through the same text file a human would git-diff." Worth
stating plainly in any dotbeat positioning copy: **not a competitor on education/privacy/free
framing** (openDAW owns that squarely and effectively) but a **different, complementary claim** —
a DAW built to be *driven*, not just *used*, by an agent. Also don't over-claim: openDAW's
scripting layer (`Werkstatt`, referenced across `plans/code-fx.md`, `plans/spielwerk.md`, and
issue #244's API request) shows real appetite for programmatic control even in their community —
that's adjacent validation that "scriptable DAW" resonates, without being the same thing as
"agent-native."

---

## 5. Candidate-feature table for dotbeat

| Feature | One-line description | Adopt / Adapt / Skip | Reasoning |
|---|---|---|---|
| **Region-level fade in/out** (linear handles, region-relative 0..1) | Two draggable handles at region edges, crossing = min of both, snap-to-grid | **Adopt** | Shipped, well-specified UX from #110; small format addition (two normalized fields per region); real user-requested gap dotbeat also lacks per `product-roadmap.md`'s "Audio-region clip editing" row (currently ❌) |
| **Cascade-delete integrity for instrument+automation** | Deleting a track must delete its owned automation/device state, not orphan it | **Adopt as a test case, not a feature** | openDAW's own box-graph (designed for cascade delete) still shipped this bug (#151) — a warning to add an explicit regression test for "delete X, assert nothing referencing X survives" once dotbeat has automation-lane-owning tracks |
| **Lightweight/shareable preset format** | Flat `{"Param": value}` JSON, skip-unknown, clamp-invalid, explicitly for sharing between people | **Adopt** | Directly matches dotbeat's own diff-friendly-text thesis; near-zero cost since dotbeat's presets are already plain text-ish; validates the format bet from the demand side (#226) |
| **Project templates** ("Save as Template," opens as a fresh unsaved copy) | Save a project as a reusable starting point; opening it never mutates the original | **Adopt** | Cheap, high-value, well-specified (openDAW's own announcement copy + `plans/templates.md` is a nearly complete spec); fits dotbeat's git-native model naturally as "copy this file/folder as a new project," possibly even cleaner than openDAW's browser-storage version |
| **Modulation/parameter-routing layer** | General LFO/env-follower → any-parameter modulation, not a fixed enumerated list | **Skip (for now), revisit later** | openDAW's own team rates this doability-1 ("foundational," unlocks 5+ other requests) — a real subsystem investment. dotbeat already deliberately chose "literal/enumerated, not a free-routing matrix" (per `product-roadmap.md`'s LFO row, citing research 18) — that decision stands; note it as the thing to revisit if/when multiple feature requests start converging on it the way openDAW's did |
| **Live real-time multi-user collaboration** | Yjs CRDT sync + deterministic box-graph reconciliation | **Skip — confirmed, don't revisit lightly** | openDAW's own `docs/live-collab-*.md` shows this is genuinely hard (silent-fork bugs, ongoing P1s) even for a team that built the box-graph from scratch with this in mind. Strong evidence dotbeat's explicit "no live collab" (`ROADMAP.md` §1) is the right call — git branch/merge is a mature substitute for dotbeat's single-user, agent-in-the-loop model |
| **Analyser/spectrum visualization device** | Real-time FFT/level visualization as an insertable device | **Adapt** | Real, moderately-requested (#203, 6 comments); dotbeat's `beat metrics` already computes spectral data server-side for agent critique (D2) — a GUI visualization of the *same* data (not a new analysis) is a cheap adapt, not a new feature |
| **Mono/legato/portamento polyphony limit per instrument** | Per-instrument voice-count + glide mode | **Adapt** | Concrete, bounded, closed-but-real request (#42); smaller than the full modulation layer; worth scoping independently rather than waiting on it |
| **"Bounce clip to audio" / freeze** | Render a MIDI clip (with its full effect chain) to a new audio clip in place | **Adopt (once audio-region clips exist)** | Open request (#301), simple mental model, and directly composable with dotbeat's existing render engine once "Audio-region clip editing" (currently a `product-roadmap.md` format gap) is built — sequence it right after that lands |
| **Reverse audio clips** | In-place reverse toggle on an audio region | **Adopt (once audio-region clips exist)** | Same dependency as above (#295); trivial once regions exist, no reason to skip |
| **Public stats dashboard** (rooms/hours/users/GitHub/NPM stats) | A marketing/community stats page | **Skip** | Built around openDAW's server-hosted, multi-user model (live rooms, hosted accounts); has no analog in a local-machine, single-user tool — GitHub stars/contributors tiles alone aren't worth building for |
| **Neural Amp Modeler (NAM) import** | Import ML guitar-amp/pedal tone models as an effect | **Skip** | Guitar/amp-sim niche, large scope (`plans/nam-integration.md` is 22KB), not aligned with dotbeat's current sound-design/critique focus; revisit only if guitar-DI workflows become a stated dotbeat use case |
| **AI-generated instruments/content (TTS, AI music gen, stem separation)** | openDIAW.be-style AI content sources bridged via an external server | **Skip, but note the axis** | Real community signal that "AI in a DAW" resonates, but it's the *content-generation* axis, not dotbeat's *agent-drives-the-project* axis. Don't chase it — it would dilute dotbeat's differentiated positioning (§4) rather than reinforce it. If ever revisited, keep it clearly separate from the agent-native story |
| **"Boundary-tolerant" numeric comparisons wherever fractional-beat and integer-tick values coexist** | Magnitude-aware float32-ulp tolerance instead of exact `<=` at region/mask boundaries | **Adopt as an engineering practice**, not a feature | Directly transferable lesson from `P1-timeline-duration-family.md` (§3) — cheap insurance if/when dotbeat's format ever mixes seconds-based audio-region boundaries with integer-tick note positions |
| **Promise-rejection-is-recoverable-by-default error policy** | Don't treat every unhandled async rejection as session-fatal; reserve fatal handling for synchronous errors | **Adopt as an engineering practice** | Cross-cutting fix noted in `error-triage.md` intro (§3) — cheap, generalizable, applies to dotbeat's own daemon/CLI error handling regardless of platform differences |
| **Agent-generated per-issue triage as a standing practice** | Use an AI agent to pre-convert every open bug/feature request into a scoped, doability-rated, file:line-cited plan before a human works it | **Adopt as a workflow**, not a product feature | `plans/issues/README.md` (§1) is a good template for dotbeat's own issue backlog once it has external users filing issues — cheap to imitate, no format/architecture cost |

---

## Sources

- Local clone: `/private/tmp/dotbeat-scratch2/opendaw` (commit `de7565a`, shallow, 2026-07-11) —
  `README.md`, `CLAUDE.md`, `future-plans/*.md`, `announcements/*.txt`, `errors/*.md` (~30 files,
  read `error-triage.md` fully + 4 representative deep-dives), `plans/*.md` (60+ files, headers
  scanned + several read in full), `plans/issues/README.md`, `docs/live-collab-*.md` (3 files).
- GitHub API (`gh api`, live, 2026-07-11): `repos/andremichelle/openDAW` metadata, issues (all
  states, sorted by comments and by `+1` reactions), discussions (GraphQL), releases, several
  individual issue/discussion bodies fetched by number (cited inline).
- `https://opendaw.studio` — WebFetch returned only the SPA shell (client-rendered app, no static
  marketing copy reachable this way); `README.md`'s own positioning language used instead as the
  more reliable primary source for how the team describes the product.
- dotbeat context: `ROADMAP.md` §1, `docs/product-roadmap.md` (feature-status table),
  `docs/decisions.md` (D1–D15), `docs/opendaw-notes.md` (prior architecture pass, not re-derived
  here).

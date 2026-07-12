# Research 40 — Ableton Live 12's groove system (ch.14) vs dotbeat's shuffle/humanize

*2026-07-12. Research-only pass, one of a parallel per-chapter set mining Ableton Live 12's
official Reference Manual (`prior_art/`, gitignored) for design ideas relevant to dotbeat. This
chapter is short (pp.330-335) and the manual text was read directly (`pdftotext -layout`), not
web-sourced — claims are cited **[manual p.NNN]** against the manual's own printed page numbers,
derived from the chapter's start page (330) plus each page-break marker in the extract. No code
was written or modified.*

## Why this chapter matters for dotbeat

dotbeat already ships two pieces of timing-manipulation machinery that look, at first glance, like
they might already cover "grooves": `src/core/groove.ts` (a reversible per-track shuffle/swing
warp, format v0.10, shipped and marked ✅ Done in `docs/product-roadmap.md` line 58) and
`src/core/humanize.ts` (seeded jitter for timing/velocity/drag/swing, also shipped). The question
this pass answers directly: does Ableton's actual groove-pool/groove-file model — a named,
**extracted-from-real-content**, reusable-across-clips template — describe something genuinely
missing from dotbeat, or is it just a different name for what shuffle+humanize already do? The
short answer, argued below: **it's a real, specific gap** — not the shuffle math, and not the
randomization, but the *extract-a-performed-feel-and-reuse-it-elsewhere* workflow, which neither
existing primitive attempts.

## 1. What a groove is in Ableton, and how it gets onto a clip

A groove is a small file (`.agr`) carrying timing and volume/velocity information, applied to a
clip to modify its "timing and feel" [manual p.330]. Live ships a library of them, browsable like
any other content, and the primary interaction is **drag-and-drop from the browser directly onto a
clip** — this "immediately applies the timing characteristics of the groove file to the clip"
[manual p.330]. A **Hot-Swap** button above a clip's own Groove chooser lets you step through the
browser's groove list while the clip keeps playing, auditioning each candidate live [manual p.330].

Grooves apply to **both audio and MIDI clips** — for audio, "grooves work by adjusting the clip's
warping behavior, and thus only work on clips with Warp enabled" [manual p.331]. This is a
structural detail worth keeping in mind for dotbeat: groove-on-audio in Ableton is implemented
*through* the warp/time-stretch machinery, not as a separate mechanism, which matters below (§5).

## 2. The Groove Pool: one shared parameter set per groove, six knobs

Applying a groove file is only step one. The **Groove Pool** (opened via a browser-view dropdown
or `Ctrl+Alt+6`/`Cmd+Opt+6`) is where a groove's *behavior* gets tuned [manual p.331]. Double-
clicking a groove in the browser loads it into the Groove Pool without yet applying it to
anything; the pool holds every groove that's either been loaded this way or is currently in use by
some clip, and grooves not currently assigned to any clip appear "inactive," their parameters
grayed out [manual p.332]. This is the load-bearing structural idea: **a groove is a shared,
named object, not a per-clip copy** — editing its parameters in the pool retroactively changes the
feel of *every* clip currently pointing at it, live, in real time [manual p.332].

The six parameters, per groove [manual pp.332-333]:

- **Base** — the timing resolution grooved notes are measured against (e.g. 1/4, 1/8). Notes in
  the groove file that fall exactly on this grid don't move; the corresponding notes in clips using
  the groove don't move either [manual p.332].
- **Quantize** — how much straight quantization is applied *before* the groove itself is applied.
  100% hard-snaps to the Base grid first; 0% leaves original clip positions untouched pre-groove
  [manual p.332].
- **Timing** — how strongly the groove's own note-position pattern pulls clips that use it [manual
  p.332].
- **Random** — adds random timing fluctuation on top, described explicitly as useful "for adding
  subtle 'humanization' to highly quantized, electronic loops" — and critically, "applies differing
  randomization to every voice in your clip," so notes that started simultaneous can end up
  randomly offset from *each other*, not just from the grid [manual p.332].
- **Velocity** (-100 to +100) — scales how much the groove file's own stored velocity data affects
  clip velocities; negative values *invert* the effect (loud notes in the groove make clip notes
  play quiet, and vice versa) [manual pp.332-333].
- **Global Amount** (0-130%) — a single master intensity dial scaling Timing/Random/Velocity across
  *every* groove currently active in the Set at once, also surfaced directly in Live's Control Bar
  when any clip has a groove applied [manual p.333].

**Committing** a groove ("Commit" button above the clip's Groove chooser) writes the pool's current
parameter effect permanently into the clip: for MIDI clips this actually moves the notes; for audio
clips it creates real Warp Markers at the resulting positions. After Commit, the clip's Groove
chooser resets to "None" — the live, non-destructive relationship ends and the effect becomes
baked-in clip data [manual p.333].

## 3. Extracting grooves: the source is always real performed content

A groove doesn't have to come from the library — it can be **extracted** from any existing audio
or MIDI clip via drag-to-Groove-Pool or an "Extract Groove" context-menu command [manual p.334].
"Grooves created by extracting will only consider the material in the playing portion of the clip"
[manual p.334] — i.e. it's not the whole file, only what's actually audible in the clip's current
loop/start/end range. To edit a groove's actual note-timing content directly (as opposed to tuning
the six pool parameters), you drag the groove file itself into a MIDI track, which materializes it
as an ordinary editable MIDI clip; converting that back into a groove closes the loop [manual
p.334].

## 4. Groove tips worth noting

Three workflow notes from the manual's own §14.3 [manual p.335], each pointing at a real design
tension:

- **Grooving a single voice** (§14.3.1): because a groove applies to an *entire clip at once*,
  getting one instrument within a multi-voice clip to sit differently (e.g. snare slightly behind
  the hats) requires physically extracting just that instrument's chain out of a Drum/Instrument
  Rack into its own new clip/track, then grooving that in isolation. The manual frames this as a
  workaround, not a first-class feature — grooving is clip-scoped, not voice-scoped, by
  construction.
- **Non-destructive quantization** (§14.3.2): with Timing/Random/Velocity all at 0%, only
  Quantize+Base active, a groove degenerates into a live, reversible, non-destructive
  quantize-to-grid — any groove file works identically for this purpose since its actual content is
  ignored.
- **Texture via randomization** (§14.3.3): duplicating a track and applying a groove with a high
  Random value to just one copy produces two "doubled" performances that are each slightly and
  differently off-grid — a cheap way to fake ensemble/doubling thickness from one voice.

## 5. Relevance to dotbeat

### 5.1 What dotbeat already has, and what each piece actually covers

dotbeat has two existing timing primitives, and it's worth being precise about which slice of
Ableton's six-parameter groove each one actually maps to:

- **`src/core/groove.ts`** (`shuffleAmount`/`shuffleGrid`, `BeatTrack` fields, `document.ts:721-722`)
  is a **pure, deterministic, reversible time-warp** — a Möbius-ease curve (`warpStep`/`unwarpStep`,
  `groove.ts:51-69`) applied at read/playback time, never baked into stored note/hit positions. It
  is explicitly modeled on openDAW's groove-as-MIDI-effect-device pattern, not Ableton's
  (`docs/research/22-opendaw-editing-workflow.md` §3.2, lines 255-307, which itself flagged "Ableton's
  own groove pool is a per-clip percentage+depth control, a different shape" without detailing it —
  this doc is the detail that pass deferred). Structurally, `shuffleAmount`+`shuffleGrid` is closest
  to Ableton's **Timing + Base** — how strongly, and against what grid resolution, notes get pulled
  toward a curve. It has **no Quantize knob, no Velocity component at all, no Random component, and
  no Global Amount** — each track carries exactly one scalar `amount`/`grid` pair, applied live and
  non-destructively (real Ableton-groove-pool parity there), exposed only through the generic
  `beat set`/`beat_set` path (`<track>.shuffleAmount`/`<track>.shuffleGrid`,
  `src/mcp/server.ts:340`), never a dedicated `beat groove` verb.
- **`src/core/humanize.ts`** is a **one-shot, seeded, Gaussian-jitter document→document edit**
  (`humanize()`, lines 62-106) touching start-time and velocity, plus constant drag (`pushLate`)
  and offbeat swing. It's the closer analog to Ableton's **Random + Velocity + (loosely) Timing**,
  and its `ids` scoping (a selection's resolved ids, `HumanizeOptions.ids`, lines 55-56) already
  gives dotbeat something Ableton's §14.3.1 explicitly frames as an awkward workaround: applying a
  distinct feel to *one voice within a clip* (e.g. "humanize just the snare hits, leave the hats
  alone") is a single scoped call today, no chain-extraction dance required, because dotbeat's drum
  lanes are already independently addressable per-hit. **This is a place dotbeat's architecture is
  already ahead of what the manual describes** — worth noting explicitly rather than only cataloging
  gaps.

Both are shipped, both are genuinely useful, and between them they cover four of Ableton's six
groove-pool knobs (Base/Timing via shuffle, Random/Velocity via humanize) reasonably well. Neither
one is a bug or a design mistake — they're deliberately different in kind: `groove.ts` is a live
parametric curve (no source data, pure math), `humanize.ts` is a one-shot destructive edit (also no
source data, pure math via a seeded RNG). **Neither captures anything from a real clip.**

### 5.2 The actual gap: no extraction, no reusable template

Ableton's chapter 14 is built around one idea dotbeat has no equivalent of at all: **a groove is
sourced from real, played content** — "the timing and volume information from any audio or MIDI
clip can be extracted to create a new groove" [manual p.334] — and, once extracted, it becomes a
**named, reusable object** you can drag onto any other clip, in this project or (via the browser's
persistent `.agr` library) any future one. That's the two-part gap, precisely:

1. **No extraction primitive.** Nothing in dotbeat reads a clip's actual note/hit positions,
   computes each one's offset from its nearest grid position (and, ideally, a velocity profile
   too), and captures that as portable data. `humanize.ts` and `groove.ts` both *generate* timing
   deviation from a formula; neither one *reads* it from anything.
2. **No reusable/named groove object.** `shuffleAmount`/`shuffleGrid` is a scalar pair living
   directly on one `BeatTrack` — there's no library, no naming, no "apply the groove I extracted
   from the drum loop I love onto three other tracks in this project." Nothing plays the role
   Ableton's Groove Pool plays: one editable object, many clips subscribing to it.

This is a real, distinct workflow from generic humanization. "Add believable random jitter" (what
`humanize.ts` does) and "make this pattern feel like *that specific* pattern did" (what groove
extraction does) solve different problems — the latter is how producers propagate a signature feel
(a sampled drum break's swing, a live-played hi-hat pattern's micro-timing) across a whole project,
and no amount of tuning `humanize`'s Gaussian std-devs reproduces a *specific* extracted pattern.

### 5.3 Recommendations

1. **Build extraction and application as one-shot document→document edits, not a new live layer.**
   Ableton's Groove Pool is live/non-destructive because its whole product is built around
   real-time clip triggering and constant re-auditioning (Session View). dotbeat's shuffle already
   owns the "live, non-destructive, parametric" niche for the procedural case; adding a *second*,
   parallel live-warp mechanism just to source it from real data would be real architectural growth
   for a workflow that's fundamentally about *reuse*, not *live tweaking*. The right shape matches
   `humanize`'s own pattern exactly: `beat groove extract <file> <track> <name>` reads a track's
   (optionally `ids`-scoped) notes/hits, computes each event's signed offset from its nearest grid
   cell at a given `--base` resolution plus a velocity delta from the track's own mean, and writes a
   named template; `beat groove apply <file> <track> <name> [--amount N]` nudges the target track's
   events toward those captured offsets, scaled by `amount` (dotbeat's own version of Ableton's
   Timing knob) — a normal, reviewable diff, same class of edit as `quantize`/`humanize` already
   are, not a new grammar concept.
2. **Store extracted grooves as project-local named content, following D9's precedent exactly** —
   "presets are tooling, never grammar" (`docs/decisions.md` D9): a groove is structurally identical
   to a preset (a named bundle of numbers, applied through the existing edit path, never an in-file
   reference). Reuse that pattern directly rather than inventing a new indirection mechanism. Unlike
   factory presets (which are shared library content, `presets/factory.json`), an extracted groove
   is inherently *this project's own captured performance* — closer to `presets/factory.json`'s
   shape than to a `.beat` field, but scoped per-project rather than shared across projects by
   default (Ableton's own browsable `.agr` library is a nice-to-have, not the core value; skip it
   for v1).
3. **Skip Ableton's Velocity-invert and Random sliders in the applied groove itself** —
   `humanize.ts` already owns "add randomization on top of a base pattern" and composes fine as a
   second pass after `beat groove apply`; don't duplicate that inside the groove primitive. Focus
   the new primitive narrowly on the one thing nothing else does: reproducing a *specific* captured
   timing/velocity signature.
4. **Skip Quantize/Base and Global Amount for v1** — dotbeat already has a separate, dedicated
   quantize operation (`quantizeNotes`, referenced in `humanize.ts`'s own header comment as
   "quantize's opposite number"); Ableton folds quantize into the groove parameter set because its
   groove is one live device doing double duty, but dotbeat doesn't need a second quantize entry
   point bolted onto groove application. A cross-track master intensity dial (Global Amount) is a
   real but low-priority nice-to-have — not worth building until multiple tracks are commonly
   sharing one extracted groove and a producer actually asks "turn the whole vibe down 20%."
5. **Note the audio-clip case doesn't apply yet, and don't over-scope trying to cover it.**
   Ableton's audio-clip grooving works *through* Warp Markers [manual p.331, p.333] — dotbeat's
   audio-region format (v0.10) only has simple rate-based repitch warping today; warp markers are
   an explicitly deferred, separately-scoped feature (`docs/research/25-audio-warp-markers-stretch.md`,
   "Not started" in `docs/product-roadmap.md`). Scope groove extraction/application to synth and
   drum (note/hit) tracks only for now — audio-clip groove is a natural follow-on once warp markers
   land, not a blocking dependency.
6. **Ship §14.3.1's "single voice" workflow as documentation, not new code** — as noted in §5.1,
   dotbeat's `ids`-scoped `humanize` and the same scoping this doc proposes for `beat groove
   extract`/`apply` already solve what Ableton needs a Rack-extraction workaround for. Worth a line
   in whatever CLI help text or skill doc covers groove/humanize, so this existing advantage is
   discoverable rather than assumed.

Net honest assessment: this is a real, well-scoped, low-architectural-risk gap — not an urgent one.
`docs/product-roadmap.md`'s "Not started" list already has higher-leverage items (undo/redo, real
wavetable synthesis, independent per-section scenes) ahead of it. But if/when groove work is picked
up again, the shape above is concrete enough to build directly from, and it fills in exactly the
"a different shape" caveat research 22 left open rather than re-treading the shuffle/humanize
ground that's already shipped.

## Sources

Ableton Live 12 Reference Manual, chapter 14 "Using Grooves," pp. 330-335 (local extract,
`pdftotext -layout`, not tracked in the repo). dotbeat internal (read directly this pass):
`src/core/groove.ts`, `src/core/humanize.ts`, `src/core/document.ts:721-722`,
`src/mcp/server.ts:340,615-617`, `docs/decisions.md` D9, `docs/product-roadmap.md` (line 58, the
"Groove / shuffle as a reversible time-warp" row), `docs/research/22-opendaw-editing-workflow.md`
§3.2 (lines 255-307).

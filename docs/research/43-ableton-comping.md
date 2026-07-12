# Research 43 — Ableton manual ch.21 "Comping" (pp.414-419): take-comping and dotbeat

*2026-07-12. One of a set of parallel research passes, each mining one chapter of Ableton Live 12's
official Reference Manual (999 pages, dropped into `prior_art/`, gitignored) for ideas/gaps
relevant to dotbeat's own design and roadmap. This pass covers chapter 21, "Comping" (pp.414-419,
the manual's own page numbers, derived from the chapter's page-footer markers in the extracted
text). Research-only — no code changes, nothing else touched.*

## How to read this

- **[manual p.NNN]** — a claim taken directly from the extracted chapter text, cited to the PDF's
  own page number.
- **[dotbeat]** — read directly from this repo's current source this pass, cited with file:line.

Comping is the practice of recording several takes of the same passage and assembling one
composite ("comp") by picking the best segments from each — the classic vocal-comping workflow,
generalized by Ableton to any audio or MIDI material. It matters for dotbeat because the product
roadmap already carries an explicit, unbuilt "Multi-take comping" line
(`docs/product-roadmap.md`'s Audio-region clip editing table), gated on M4's native audio engine —
and because dotbeat's git-native premise (`docs/decisions.md` D3/D10, `src/history/`) is the kind
of thing that might answer "pick the best take" differently than a dedicated comping UI, which is
exactly what this pass was asked to check.

## 1. What a take lane is

Every audio or MIDI track in Arrangement View can carry multiple parallel lanes: one **main lane**
(audible by default) plus any number of **take lanes**, which are only audible when Audition Mode
is enabled **[manual p.414]**. Take lanes are created automatically while recording, or inserted
manually **[manual p.415]**; visibility toggles per track (`Ctrl Alt U` / `Cmd Option U`, or a
show/hide control in the main lane header) **[manual p.415]**. Take lanes are deliberately hidden
while Automation Mode is active — entering either mode from the other forces an exit **[manual
p.415]**.

The chapter's own framing of what take lanes are *for* is broader than "comp a vocal take":
*"Live can create take lanes in a track as you record material... You can also store alternative
versions of a clip arrangement on multiple take lanes, or drag samples from your library onto take
lanes and use comping as a creative sample-chopping tool"* **[manual p.414]**. Three distinct use
cases are named in that one sentence: (a) picking the best recorded take, (b) storing several
hand-built alternative arrangements of a clip side by side, (c) using take-lane machinery as a
sample-chopping tool with no recording involved at all — none of these three require the clip
content to be audio specifically.

## 2. Managing take lanes

Lanes are inserted via the Create menu, a track/lane header context menu, or `Shift Alt T` /
`Shift Option T`, and can be added to multiple selected tracks at once **[manual p.415]**.
Duplicate (`Ctrl D` / `Cmd D`), delete (`Backspace`/`Delete`), "Delete All Take Lanes," and "Delete
All Unused Take Lanes" (removes lanes with no material *currently used in the comp*, a real
cleanup/hygiene command) are all named operations **[manual p.416]**. Lanes resize (`Alt`/`Option`
+/- or scroll-wheel), reorder by drag or `Ctrl`/`Cmd` + arrow key, and rename via the Edit menu or
`Ctrl R`/`Cmd R`, with `Tab`/`Shift Tab` to walk between lanes while renaming several at once
**[manual p.416]**.

## 3. Recording takes

While recording in Arrangement View, take lanes are auto-added to armed tracks and new clips land
inside them **[manual p.416]**. Recording over an existing clip — whether as discrete passes or in
a loop — adds one new take lane per pass; an existing empty lane is reused automatically if nothing
already occupies it after the punch-in point **[manual p.416]**. Critically: **the most recently
recorded clip is always copied into the main lane**, so it's immediately audible on normal playback
without any comping decision having been made yet **[manual p.417]** — the "last take wins" default
until the user deliberately picks something else. Recorded clips inherit the track's color by
default; a Theme & Colors setting can randomize per-take color instead, purely as a visual
disambiguation aid **[manual p.417]**.

Samples/MIDI files can also be dragged onto take lanes directly from the browser or Finder/Explorer
— `Ctrl`/`Cmd`-drag with multiple files selected distributes them across sequential tracks
**[manual p.417]**. This is use case (c) from §1: comping as a sample-arranging tool, no recording
involved.

## 4. Auditioning

A speaker-icon button in a take lane's header, or the `T` shortcut, auditions that lane — you can
audition one lane per track simultaneously across several tracks, but never more than one lane at a
time within a single track; if a selection spans multiple lanes on one track, the last-selected
lane wins **[manual p.417]**.

## 5. Building the comp

The actual compositing gesture, once takes exist **[manual p.418]**:

- **Enter**, or a take lane's "Copy Selection to Main Lane" context command, copies selected take
  material into the main lane.
- **`Ctrl`/`Cmd` + Up/Down arrow** on a clip-header or time selection (in either the main lane or a
  take lane) replaces that stretch of the main lane with the content of the next/previous take
  lane; empty lanes are skipped, and a selection already on a take lane advances to the next/prev
  take too.
- **In Draw Mode**, a single click-drag-release gesture on a take lane copies the dragged material
  straight into the main lane; clicking a take lane while a time selection exists on the main lane
  replaces just that selected span with the corresponding portion of the clicked take.
- Take-lane clips are also draggable/pasteable straight into Session View clip slots.

The load-bearing structural fact: **clips copied into the main lane are independent copies, not
live references** — editing a main-lane comp clip never touches the source take-lane clip and vice
versa **[manual p.418]**. Take-lane clips otherwise behave like any other Arrangement clip (move,
copy/paste, drag/drop, consolidate, crop, duplicate). An optional "Create Fades on Clip Edges"
setting auto-crossfades adjacent clips by 4ms to avoid clicks at comp seams; the same crossfade can
be applied manually to a multi-clip selection via `Ctrl Alt F`/`Cmd Option F` **[manual p.418]**.

## 6. Source highlights

For every comp assembled in a main lane, Live highlights the corresponding source material in the
take lanes using the track's color; unused material in those same lanes is shown desaturated —
purely so the user can see, at a glance, which recorded fragments made it into the final comp
**[manual p.419]**. This highlighting only appears when the take-lane clips have matching
positions/properties to the main-lane comp, and the boundary between two adjacent highlighted
segments can be dragged to shift the comp's split point directly **[manual p.419]**. This is
presentation-layer bookkeeping, not new project data — it's Ableton computing and displaying
"which take contributed which bars" from the state that already exists, not storing a separate
provenance record.

## 7. Relevance to dotbeat

### dotbeat has no take/version concept for a clip today — confirmed from source, not assumed

`BeatClip` **[dotbeat, `src/core/document.ts:544-552`]** has exactly one content shape per clip:
notes (synth/instrument), hits (drums), or one `BeatAudioRegion` (audio) — plus automation and an
optional loop/signature override. There is no "lanes," no "parallel candidate content," no
provenance field. Nothing in `src/core/edit.ts`, the CLI (`cli/beat.mjs`), or the MCP server
(`src/mcp/server.ts`) has any comping-shaped verb. The product roadmap already names this gap
explicitly and honestly: `docs/product-roadmap.md`'s Audio-region clip editing table carries
*"Multi-take comping, freeze/flatten/bounce | Needs the butler-thread disk-streaming architecture
already scoped for M4.2 — a different problem from single-clip warping"* — Not Started, gated on
`docs/m4-native-engine-design.md`'s M4.2 stage. This pass confirms that gating is correctly reasoned
for the **audio** half of comping (§8 below) but is narrower than what this chapter actually
describes — see the recommendation in §8.1.

### The genuinely different, git-native shape of "pick the best take"

The prompt's hypothesis — that dotbeat's version-history mechanism might answer this differently
than a dedicated comping UI — holds, but only for *part* of what this chapter covers, and it's
important to be precise about which part:

- **`src/history/history.ts`** (`checkpoint`/`restore`/`pin`) operates at **whole-document
  granularity** — a checkpoint is a full `.beat` file snapshot (a git commit), `restore` is
  append-only (writes old bytes back, takes a fresh checkpoint, never rewrites history —
  `history.ts:270-297`), and a pin is a named git tag on one such commit (`decisions.md` D10).
  This is a real, shipped answer to *"keep every complete take and let me go back to any one of
  them"* — record take 1, checkpoint; record take 2, checkpoint; pin the best one "vocal take 3" —
  and it is honestly **not** the same operation as comping. Comping's whole point is assembling
  **parts** of *multiple simultaneous* takes into **one new** composite; checkpoint/restore
  chooses **one entire past state** wholesale. They're answers to two different, adjacent
  questions — "which whole version do I want" vs. "which fragments of which versions do I want,
  combined" — and dotbeat's history mechanism only solves the first one today.
- Where it *does* genuinely substitute for comping, without needing any new machinery: the common
  case of **"just pick the best whole take, no splicing needed."** If each take is recorded/authored
  as its own full document state (or, more precisely, its own named `BeatClip` — see below),
  checkpoint history already gives free provenance ("go back to a3f19c2 (bass: take 2, cutoff
  1200->900)"), free comparison (`beat diff` between any two checkpoints reads like an edit list,
  not a binary diff), and a pin as a human-legible bookmark — genuinely better audit trail than
  Ableton's ephemeral, UI-only source highlighting (§6), which exists only while the project is
  open and isn't itself project data.
- **True segment-level comping needs a different primitive**, one dotbeat doesn't have: something
  that reads bars `[a,b)` from take-clip X and bars `[b,c)` from take-clip Y into a destination
  clip. That's structurally close to existing primitives like `splitAudioClip`
  (`docs/research/16-audio-clip-editing.md` §2) or the Pitch & Time ops in
  `src/core/pitchtime.ts` — a pure edit primitive over clip content, no DSP, no engine change — but
  it doesn't exist yet, for either MIDI or audio clips.

### The format already supports "alternative takes as sibling clips," at zero cost

`track.clips[]` **[dotbeat, `document.ts:705`]** is already an array of independently-named
`BeatClip`s, and `BeatScene.slots` **[dotbeat, `document.ts:560-563`]** already maps
`trackId -> clipId` per scene. This means dotbeat can represent Ableton's use case (b) from §1
— *"store alternative versions of a clip arrangement"* — **today, with the existing v0.10 grammar,
zero format changes**: author `clip take_1`, `clip take_2`, `clip take_3` on the same track (three
full sets of notes/hits, or later three `BeatAudioRegion`s), audition each by pointing a scene's
slot at it (`setScene`/`beat scene`, `src/core/edit.ts:984`), and when one wins, either leave the
slot pointed at it or `saveClip` its content into a canonically-named "comp" clip. This is a real,
literal-data-only, agent-drivable workflow with no new grammar — it's the Vary/audition loop's
existing pattern (`beat vary`/`beat score`, §7 of `ROADMAP.md`) applied to hand- or AI-authored
takes instead of parameter mutations. The one thing missing to make this a first-class "comping"
feature rather than a manual workaround is the segment-splice primitive from the previous
paragraph, plus (optionally, later) a GUI surface for it.

### The MIDI/drum half is not actually gated on M4

This is the sharpest, most actionable finding of this pass, and it's worth stating plainly because
the current roadmap phrasing risks conflating two different problems: **Ableton's own chapter is
track-general, not audio-specific** — "every audio or MIDI track" gets take lanes **[manual
p.414]**, and use case (b) ("alternative versions of a clip arrangement") is meaningfully MIDI too.
dotbeat's synth and drum tracks already have everything the *sibling-clips* half of comping needs
(multiple named `BeatClip`s per track, scene-slot swapping, `saveClip` re-snapshot) with **no
dependency on audio recording, disk streaming, or M4 at all**. The roadmap's current framing —
"needs the butler-thread disk-streaming architecture... a different problem from single-clip
warping" — is correctly reasoned for *audio* comping (recording real takes needs native latency
recording, which is confirmed M4/Tauri-gated by the ~30ms web latency wall,
`docs/research/02-web-stack-feasibility.md`) but shouldn't be read as gating MIDI/drum comping,
which could be scoped and built independently, sooner, as a pure edit-primitive + CLI/MCP feature
exactly like the rest of this project's CLI-first build pattern (D14).

### Provenance: dotbeat's version already beats Ableton's

Ableton's source highlighting (§6) is real-time UI decoration computed from live project state —
useful, but gone the moment you're not looking at the take lanes, and not itself stored data. If
dotbeat builds the segment-splice primitive as a normal edit primitive (in the spirit of D8's
`DiffEntry`), every comp decision becomes a literal, permanent, `git`-diffable fact: "bars 1-4 from
take_2, bars 5-8 from take_1" is not just visible while editing, it's in the commit history forever,
readable by a human or an agent months later without opening the project. This is the same "format
IS the product" argument the rest of the roadmap already makes (§4 of `ROADMAP.md`) — comping is
just one more place where a diff-friendly text file's audit trail beats a DAW's live-only visual
state, and it's worth naming explicitly if/when this becomes real work.

## 8. Recommendations

1. **Split the roadmap line.** `docs/product-roadmap.md`'s single "Multi-take comping,
   freeze/flatten/bounce" row conflates a genuinely M4-gated feature (audio comping, needs
   recording + the butler-thread architecture) with a feature that has no such dependency
   (MIDI/drum comping, buildable on the current format + a new edit primitive). Worth a small
   follow-up to `scripts/roadmap-data.mjs` splitting these into two rows so MIDI/drum comping isn't
   silently stuck behind M4's audio-engine timeline. **Low effort, do this whenever the roadmap
   next gets touched — not urgent enough to justify a dedicated stream on its own.**
2. **When comping is actually scoped (not now — see §8.4), design it CLI/MCP-first, as edit
   primitives over sibling clips, not a ported take-lane UI.** Concretely: (a) no new format
   concept needed for "store N alternative takes" (already free via `track.clips[]` +
   `BeatScene.slots`); (b) one new primitive for true segment-level splicing (read bars `[a,b)`
   from clip X into clip Y) — sized similarly to `splitAudioClip`, format-neutral (works
   identically for notes/hits/audio regions); (c) a GUI take-lane-style visualization, if ever
   wanted, is a rendering layer on top of (a)+(b), not a prerequisite — consistent with how this
   project has sequenced every other feature (CLI/MCP ships, GUI catches up later, D14).
3. **Don't build a separate "source highlight" visual-provenance system.** Once comps are built as
   literal edit primitives, `git log -p` / `beat diff` on the destination clip already gives a
   strictly more durable provenance record than Ableton's live-only highlighting (§6, §7 above).
   If a GUI comping surface is ever built, a highlight overlay is a nice-to-have rendering of data
   that already exists in history — not new data to invent.
4. **Overall priority: low, and correctly so — don't reprioritize based on this doc alone.** Full
   audio comping is honestly gated on two things dotbeat doesn't have yet and that are bigger,
   more clearly load-bearing gaps in their own right: native audio recording at all (zero capture
   path exists today, confirmed `docs/product-roadmap.md`'s Audio-region clip editing table) and
   the M4 native engine generally. MIDI/drum comping is unblocked but has **no signal of demand**
   behind it — no owner ask, no research finding elsewhere in this repo naming it as a felt gap,
   and it would compete for stream time against features with clearer pull (undo/redo, the
   in-flight FX/arrangement work). Recommendation is specifically: **note the decoupling (§8.1),
   don't schedule the build.** Revisit once either (a) real usage surfaces a concrete want for
   "audition several arrangement variants of the same clip live," which the sibling-clips pattern
   already answers with zero new code, just documentation/discoverability, or (b) M4 audio
   recording lands for real, at which point the audio half becomes worth a proper scoping pass of
   its own (its own format questions — e.g. does a track's `clips[]` array plus a `kind: 'take'`
   marker distinguish "candidate take" from "real content," or is naming convention enough — are
   untouched by this research-only pass and would need one before implementation).

## Sources

Ableton Live 12 Reference Manual, chapter 21 "Comping", pp. 414-419. dotbeat internal (read
directly this pass): `docs/product-roadmap.md` (Audio-region clip editing table), `docs/decisions.md`
(D3, D10), `src/core/document.ts` (`BeatClip` lines 544-552, `BeatScene` lines 558-563, `track.clips[]`
line 705), `src/history/history.ts` (checkpoint/restore/pin, in full), `docs/research/16-audio-clip-editing.md`
(§2 split-at-point, §7 M4/engine-architecture cross-reference), `docs/m4-native-engine-design.md`
(M4.2 stage), `docs/research/02-web-stack-feasibility.md` (the ~30ms web recording-latency wall).

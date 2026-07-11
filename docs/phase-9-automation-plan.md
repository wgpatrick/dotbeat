# Phase 9 — clip automation grammar (format v0.9)

*Closes the exclusion phase-6 called out by name when it shipped clips/scenes/song (v0.4):
"clip automation (needs the automation grammar — next format phase)."*

## Problem

A clip is a named snapshot of a track's playable content — notes or drum hits — but nothing in
the format lets a clip say "and the filter cutoff sweeps up through this note." beatlab's own
clip model already carries automation as engine state (`phase-6-plan.md`'s source-verified
survey: "Clips ... named, self-contained snapshots of a track's notes/pattern/automation" —
pure storage, the engine never reads it directly, same as notes/pattern before v0.2/v0.8 gave
them a text form). Through v0.8, any clip automation present in a converted beatlab project was
silently reported as dropped (`droppedFields: "<track>.<clip>.automation"`) — a real, if honest,
gap: the file could not state "and the cutoff moves" even though the app it mirrors can already
do that motion, per-clip.

## Design

### Scope decision: clip-only, not live-track

Automation attaches to a `BeatClip`, never to a track's live (non-clip) content. Two reasons:

1. **There's nothing to mirror.** beatlab's automation concept is specifically a *clip* field
   (`Clip.automation`, per the phase-6 survey). There is no live-track automation in the app to
   converge on, so adding one to the format would be inventing a second, unrelated feature rather
   than closing the stated exclusion.
2. **It keeps the grammar decision small and reversible.** If live/timeline automation (moving a
   param across the whole song, independent of any clip) turns out to be wanted later, it's a new
   addition on top of this one — clip automation doesn't need to be redesigned to make room for
   it.

This is a deliberate, documented choice, not an oversight — see format-spec.md's v0.9 section.

### Grammar

```
  clip verse-a
    note n1 57 0 4 0.8
    auto lead.cutoff
      point p1 0 900
      point p2 2 3200
```

- `auto <track>.<param>` opens one lane per param per clip. The target repeats the enclosing
  track's own id (the same `<track>.<param>` addressing `beat set` already uses) rather than a
  bare param name — a lane header is then self-describing in isolation, and the parser can catch
  a copy-pasted block landing in the wrong track (`auto target track "X" must match the
  enclosing track "Y"`) instead of silently automating the wrong thing.
- `param` is restricted to numeric synth fields — `AUTOMATABLE_SYNTH_PARAMS` in
  `src/core/document.ts`, derived from the existing `SYNTH_PARAM_ORDER` (core 9 minus the enum
  `osc`) and `SYNTH_FIELDS` (v0.3's optional table, filtered to `kind === 'number'`) rather than a
  hand-maintained parallel list — the project's "one table, many consumers" house style
  (`document.ts`'s own framing for `SYNTH_FIELDS`). Enum/bool/trackref fields don't have a
  meaningful (time, value) curve and are rejected at both parse and edit time.
- `point <id> <time> <value>` — stable id (D6), `time` fractional 16th steps from the clip's own
  start (v0.7 number rules: same unit/precision discipline as note/hit `start`), `value` in the
  param's own raw units. No `interpolation` column (DAWproject's `hold`/`linear`, sketched in
  format-spec.md's "Future" section) — out of scope this phase, see Deferred below.
- **Elision**: a lane exists only while it has >= 1 point (parse rejects an `auto` header with
  zero children) — no canonical form for "an automation lane that automates nothing," the same
  discipline as v0.3's synth-field elision. A clip with no automation emits zero `auto` lines,
  and every v0.8 file (predating the grammar entirely) parses unchanged — both tested.
- **Canonical order**: lanes in first-seen (creation) order per clip, like clips themselves;
  points within a lane sorted `(time, id)` ascending, like notes `(start, pitch, id)` and hits
  `(start, lane, id)`.

### Parser implementation note

This is the first grammar construct that needs a third indentation level: `track`(0) →
`clip`(1) → `auto`(2) → `point`(3). The existing parser only handled levels 0-2 (anything deeper
was "indentation too deep"); v0.9 adds a level-3 branch and a `currentAutoLane` piece of parse
state that any level <= 2 line closes (validating point count and id uniqueness) before
processing itself — the same close-on-dedent discipline the parser already used for synth blocks
and legacy pattern accumulation, just one level deeper.

### Diff

Unlike clip notes/hits (reported as a delta count on re-snapshot, since re-authoring a clip's
whole content is common and itemizing every note would mostly be re-snapshot noise), automation
points are itemized per-point, matched by `(param, id)`:

```
lead: clip "verse-a" cutoff automation point added p3 (step 3, value 100)
lead: clip "verse-a" cutoff automation point p2 value 900 -> 3200
lead: clip "verse-a" cutoff automation point p2 time 2 -> 3
lead: clip "verse-a" cutoff automation point removed p2 (step 2, value 3200)
```

A knob move mid-clip is a specific, namable musical fact — unlike bulk note re-recording, it's
exactly the kind of single-parameter change D4 wants to read as a clean, minimal diff.

### Edit primitives (`src/core/edit.ts`)

`addAutomationPoint` / `moveAutomationPoint` / `removeAutomationPoint` (drops the whole lane if
it was the last point) / `setAutomationPoint` (add-or-move in one call, keyed by id — what the
CLI/MCP surface calls, so callers don't have to know in advance which case they're in). `saveClip`
(re-snapshotting a track's live content into an existing clip) now preserves that clip's existing
automation instead of wiping it: notes/hits come from the track's *live* content, but there's no
live-track automation to snapshot from, so a re-snapshot leaves automation alone — the one field
a re-snapshot doesn't touch.

### CLI / MCP

- `beat automate <file> <track> <clip> <param> <time> <value> [--id p1]` — adds a new point, or
  moves an existing one if `--id` names a point already in that lane.
- MCP tool `beat_automate` mirrors it exactly (same add-or-move semantics via `id`).

### Converter (`src/core/convert.ts`)

beatlab's clip automation now converts instead of being reported dropped. The assumed source
shape (`ExternalClipAutomation = Record<paramName, { time, value }[]>`) mints the format's
required stable point ids (`p1, p2, ...`, ascending by time) on the way in, and strips them back
off on the way out (`beatDocumentToPartialTracks`) — see the "Deferred / honest gap" section
below for exactly how confident that shape is.

## Exit criteria

- [x] Stable ids on points; canonical time ordering; byte-identical round trip
      (`serialize(parse(x)) === x`).
- [x] Elision: a clip/track with no automation has zero automation lines; v0.8 files parse
      unchanged (both directly tested).
- [x] `diff.ts` produces musical, per-point add/remove/move/value-change entries, not textual
      diffs.
- [x] `edit.ts` primitives mirror `addNote`/`addHit`'s shape.
- [x] `convert.ts`: clip automation converts; loss reporting updated to cover only truly
      unmodeled automation params.
- [x] `inspect.ts` shows lane/point counts per clip.
- [x] CLI + MCP surface (`beat automate` / `beat_automate`).
- [x] New tests (`test/format-v09-automation.test.ts`, 33 tests) cover round-trip, elision, diff
      phrasing, edit primitives, and "v0.8 files parse unchanged"; all pre-existing tests stay
      green.

## Result (2026-07-11)

Shipped: the grammar (`auto`/`point`, a new third indentation level), `BeatAutomationLane`/
`BeatAutomationPoint` in `document.ts` plus the derived `AUTOMATABLE_SYNTH_PARAMS` table,
parser/serializer support, four `diff.ts` DiffEntry variants with musical phrasing,
`inspect.ts`'s per-clip lane/point-count summary, four `edit.ts` primitives, the
`beat automate` CLI command and `beat_automate` MCP tool, and `convert.ts` wiring in both
directions. Format version bumped to 0.9 (`initDocument` and the converter's stamped output
version) since new documents and converted-from-beatlab documents now use the v0.9 grammar.

Test suite: 229 tests, 223 passing — up from a 196-test baseline already present on this branch
before this phase started (the task brief's stated 187/181 baseline predates several since-landed
features; 196/190 with the same single known flake was the actual starting point measured here).
The only failures are the six pre-existing `test/history.test.js` cases, a macOS
tmpdir-symlink-vs-git-realpath mismatch unrelated to this change (confirmed present before any
edit in this phase, by stashing and re-running).

**Deliberately deferred, stated honestly rather than rounded up to "done":**

- **Interpolation / curve shape.** Points are `id, time, value` only — no `hold`/`linear` column
  (DAWproject's pattern, sketched in format-spec.md's older "Future" section but not adopted
  this phase). Every automated param currently reads as a sequence of points with no defined
  in-between behavior; an engine consuming this would need to pick a convention (most likely
  linear interpolation, matching most DAWs' default) until the grammar says otherwise. Left out
  because the task's suggested grammar shape didn't include it and adding a third grammar
  dimension (id, time, value, *and* curve-per-point or curve-per-segment) is its own design
  question deserving a dedicated pass, not a rider on this one.
- **Live/non-clip automation.** Explicitly out of scope by design (see "Scope decision" above),
  not an oversight.
- **The beatlab engine-side wiring is an honest, documented gap, not a verified fact.** This
  worktree has no local beatlab checkout (confirmed: no `beatlab` directory anywhere in the repo
  tree, and `test/fixtures/real-sandbox.beatlab.json` — the one piece of real exported beatlab
  state available — has every clip's automation field empty (`"clips": []` throughout), so it
  cannot confirm or refute any assumed shape). `src/core/convert.ts`'s `ExternalClipAutomation`
  type (`Record<paramName, { time, value }[]>`, no point ids) is an *inferred* shape — inferred
  from the previous, looser `ExternalTrack.clips[].automation?: Record<string, unknown>` typing
  and phase-6-plan's one-line note that clip automation "exists in beatlab but is not modeled by
  the format yet." The `.beat`-side round trip (parse ↔ serialize ↔ the assumed JSON shape) is
  rigorously tested (33 new tests, including a synthetic conversion fixture); what is NOT
  verified is whether beatlab's actual `Clip.automation` field really is shaped that way, whether
  its engine tick actually reads/applies it during playback (per phase-6-plan, "the engine never
  reads clips directly" for notes/pattern either — automation may be the same, pure storage), or
  how the browser-side daemon bridge would carry `auto` edits back into a live beatlab session.
  Anyone wiring this up against real beatlab source should verify the shape first and adjust
  `toBeatClipAutomation`/`beatDocumentToPartialTracks`'s clip-automation mapping accordingly
  before trusting the conversion path against live data.
- **Per-param value range validation.** `point` values are accepted as any finite number
  regardless of which param they target (Hz for cutoff, 0..1 for resonance-like params, etc.) —
  consistent with how the existing v0.3 table-driven synth-field parser already treats numeric
  fields (no range checks beyond a small hand-picked set like `pan`/`velocity`), but worth naming
  as a real, if narrow, validation gap: an automation point can currently set `resonance` to
  `50` without the parser objecting.
- **Render/engine verification.** No offline-render or playback verification was attempted this
  phase (no beatlab checkout to render against) — this phase is `.beat`-format-only, matching the
  "model the round-trip on the .beat side rigorously, note the beatlab-side wiring as a
  documented gap" instruction it was scoped under.

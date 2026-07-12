// Single source of truth for docs/product-roadmap.md and its artifact rendering.
// status: 'done' | 'progress' | 'not-started'  (progress reserved for future use — nothing is
// mid-stream right now, all seven Phase 19-21 streams just landed)
// layer values: 'done' | 'partial' | 'missing' | 'na'

export const rows = [
  // ── File format & core engine ──────────────────────────────────────────
  {
    area: 'File format & core engine', feature: 'Diff-friendly canonical text format (.beat v0.9)',
    description: 'The .beat grammar itself: stable IDs, canonical field order, byte-identical round-trip.',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: 'research/04-format-prior-art.md', plan: 'format-spec.md',
  },
  {
    area: 'File format & core engine', feature: 'git-lfs media/binary handling',
    description: 'Presets and sample media stored via git-lfs so the text file stays diff-clean (decisions.md D11).',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: null, plan: 'decisions.md',
  },
  {
    area: 'File format & core engine', feature: 'Reference-counted git-lfs asset GC',
    description: 'A `beat gc <file>`-style command diffing `media/` against the document\'s own media block, so orphaned sample/preset media can be safely deleted. git-lfs dedupes by content hash within a repo but has no native answer to "is this still used anywhere." Ableton\'s own Finding Unused Files (manual ch.5, research/52) names the identical feature and the same honest scoping caveat worth carrying over: a per-project scan can only ever say "unused by this project," not "unused anywhere on disk" — state that plainly in the CLI help text rather than over-promising. Pairs directly with the `beat relink` row below.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },
  {
    area: 'File format & core engine', feature: 'git-lfs file locking for binary media',
    description: 'Adopt git-lfs\'s existing `git lfs lock` (unused today) as a soft mutex with an honest override warning — the one part of a .beat project git genuinely can\'t diff/merge.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/23-opendaw-collaboration-storage.md', plan: null,
  },
  {
    area: 'File format & core engine', feature: 'Locating missing/moved media files + repair (`beat relink`)',
    description: 'Today a missing or moved media file is a silent 404 with zero repair path anywhere (src/daemon/daemon.ts:666,690) — a real, user-facing regression versus Ableton\'s own Locating Missing Files flow (manual ch.5) even though dotbeat\'s underlying integrity guarantee (sha256-verified media, D11) is structurally stronger. `beat relink <file> [--search <dir>]` would walk candidate files, compute sha256, and match exactly against any `BeatMediaSample` whose declared path 404s — unambiguous by construction, unlike Ableton\'s "several candidates, please choose" repair flow for an already-known file. Surface a "N media files missing" banner in the GUI wired to the same route.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },
  {
    area: 'File format & core engine', feature: 'File Reference List UI (`beat media list` / media panel)',
    description: 'Ableton\'s "View Files" panel lists one row per referenced file, expandable to every clip/slot using it, with per-row Replace/Hot-swap/Edit and a Location column (manual ch.5). dotbeat has no equivalent inventory of what media a project actually references. `beat media list <file>` (id/path/sha256/on-disk status/referencing tracks-clips-lanes), backed by a new `GET /media-refs` daemon route, plus a Media panel in `ContentBrowser.tsx` surfacing the same with a per-row Replace action — pairs naturally with the relink row above.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },
  {
    area: 'File format & core engine', feature: 'MIDI file import/export (`.mid`)',
    description: 'dotbeat has no `.mid` import/export path anywhere in `src/core`, `cli/`, or `src/daemon` (confirmed by direct grep this pass). Ableton\'s own precedent: importing a `.mid` bakes its data into a clip and severs the source file reference entirely; exporting a clip produces a standalone Standard MIDI file (manual ch.5, pp.127-128). `beat import-midi <file.mid> <dest.beat> <track>` should follow the identical severed-reference discipline (matches D1\'s document-only philosophy — independently validated, not invented, by Ableton\'s own choice here); `beat export-midi` is the inverse. CLI/MCP-only for v1, no GUI required to ship real interop value.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },

  // ── Track management ────────────────────────────────────────────────────
  {
    area: 'Track management', feature: 'Add / delete tracks',
    description: 'Create a new synth/drums/instrument track or remove one, from the GUI or CLI.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-track-project-management.md',
  },
  {
    area: 'Track management', feature: 'Rename / recolor tracks',
    description: 'Inline double-click rename and a color picker on each track header.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-track-project-management.md',
  },
  {
    area: 'Track management', feature: 'Group tracks',
    description: 'Fold N tracks into one collapsible group header. A group is a flat, named, colored membership list (`group <id> <name> <color> <track-id>...`, v0.10) — a track belongs to at most one group, no nesting. Collapsed/expanded is deliberately UI-only session state (like mute/solo), never written to the file.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-af.md',
  },
  {
    area: 'Track management', feature: 'Reorder tracks by dragging',
    description: 'Ableton: "tracks can be reordered by selecting and dragging them above or below other tracks" (manual ch.6, p.152). dotbeat has reorder primitives for effect chains (`moveEffect`), drum lanes (`moveLane`), and song sections (`songMove`), but none for `doc.tracks` order — confirmed absent this pass. New `moveTrack(doc, fromIndex, toIndex)` in `src/core/edit.ts`, same splice-not-delete-insert shape as `songMove`; a drag handle on `.arr-track-header` reusing the native HTML5 drag-and-drop pattern the section chips already use.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },

  // ── Note editing (piano roll) ───────────────────────────────────────────
  {
    area: 'Note editing (piano roll)', feature: 'Core note editing: add/move/resize/multi-select/marquee',
    description: 'Free-timed notes, keyboard strip + octave gridlines, pitch-aligned within 1px.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-19-piano-roll-keys.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Fold mode',
    description: 'Collapse the piano roll to only the pitches actually in use, like Ableton\'s Fold — a distinct, cheaper mechanism than Fold-to-Scale below (the manual itself draws this as a separate feature, ch.10 p.269-272). Close to free given the row-axis abstraction NoteView.tsx already generalized for the drum-lane adapter: a derived rows list filtering `buildPitchAxis`\'s full range down to only pitches with ≥1 note, no format change. Sequence before Fold-to-Scale so the row-axis adapter grows one fold mode at a time.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Scale-lock field + scale-tone highlighting (Scale Mode)',
    description: 'Ableton\'s Scale Mode is a persistent, propagating layer, not one flag: a Root Note + Scale Name toggle, Highlight Scale vs. Fold-to-Scale as two distinct piano-roll options, an independent flats/sharps/auto note-spelling preference, and propagation into Pitch & Time / MIDI Tools "Use Current Scale" toggles (manual ch.10 pp.269-272, ch.11 p.279). dotbeat already ships the one-shot transform (`fitToScaleNotes` + the `SCALES`/`nearestScaleTone` table, src/core/pitchtime.ts:102-134) but zero stored scale field anywhere — confirmed by grep across `src/core/document.ts`. Add an optional, elided `scale?: {root, name}` to `BeatClip`/`BeatTrack` (same pattern as `BeatClipLoop`), shade in-scale rows in `NoteView.tsx`\'s `buildPitchAxis`. Every generative note tool below (Euclidean/Seed/Stacks/Shape) inherits this same scale-awareness gap until it lands.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Pitch & Time operations (transpose, ×2/÷2, fit-to-scale, invert, humanize, reverse, legato)',
    description: 'One-shot edit primitives (src/core/pitchtime.ts) that rewrite note lines and produce a normal diff — same pattern as quantize. beat_humanize already covered the Humanize row (tracked separately under "Vary / audition loop" — its own GUI affordance is Stream BB\'s territory). Phase 22 Stream AD added transpose/time-scale/fit-scale/invert/reverse/legato as CLI verbs + MCP tools; Phase 23 Stream BA added a Pitch & Time panel in NoteView.tsx (always visible for a note track, scoped to the current note selection or the whole track) that calls the six ops plus Consolidate through a new daemon route (POST /pitch-time — AD shipped CLI/MCP-only "no daemon route needed," but each op\'s own batch parameter shape needed one after all, same as /song and /audio-split). Verified live: ui/verify-phase23-stream-ba.mjs drives real clicks and checks the resulting .beat diff for each of the seven ops.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Groove / shuffle as a reversible time-warp',
    description: 'Two literal track-level fields (shuffleAmount, shuffleGrid — src/core/document.ts) applied at read/playback time via warpStep()/unwarpStep() (src/core/groove.ts, a Möbius-ease curve; exact-inverse round-trip unit-tested), never baked into stored note/hit start; ui/src/audio/engine.ts hand-mirrors the same math and applies it in the synth/instrument note-scheduling loop (drum-hit scheduling remains a follow-on, unchanged this stream). Phase 23 Stream BA added a Shuffle/Grid knob pair to each mixer channel strip (MixerView.tsx), writing shuffleAmount/shuffleGrid through the existing `<track>.shuffleAmount`/`<track>.shuffleGrid` postEdit grammar — no new CLI verb or daemon route needed, same as AD left it. Verified live (a real knob drag produces the exact `groove <amount> <grid>` line on disk).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Per-note probability (chance)',
    description: 'A 0-100 int field (default 100 = today\'s always-fires behavior), re-rolled via a seeded RNG (src/core/chance.ts\'s chanceFires — mulberry32 + FNV-1a seed fold) once per playback pass in the scheduler, verified directly against the seeded sequence (statistical unit tests) rather than by rendering audio repeatedly. GUI: the Phase 22 per-note inspector panel remains for typing an exact value; Phase 23 Stream BA added the missing at-a-glance layer — a chance<100 note draws dimmed + dashed in the piano roll — plus a new chance lane below the velocity lane supporting a genuine draw-ACROSS-notes paint gesture (research 22 §1.4\'s PropertyDrawModifier reference): one continuous drag paints every note the pointer sweeps over to the same probability, not just the note first pressed. Verified live.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Note ratchet / repeat (play-count + curve)',
    description: 'The richer 3-field shape (ratchetCount + ratchetCurve + ratchetLength) research 22 recommends over openDAW\'s own 2-field version (their team is mid-refactor away from it). src/core/pitchtime.ts\'s ratchetSlots is the one spacing function both live playback (engine.ts, hand-mirrored) and `beat consolidate`/`beat_consolidate` (bakes a ratchet back into exact discrete notes) agree on. GUI: the Phase 22 per-note inspector panel remains for typing exact values; Phase 23 Stream BA added a visual tick-mark glyph on a ratcheted note itself (one mark per internal repeat boundary, using the same curve-warped spacing ratchetSlots computes) and wired Consolidate into the new Pitch & Time panel as a real button. Verified live: setting ratchetCount=4 shows exactly 3 ticks, and Consolidate produces exactly 4 discrete notes at the exact expected positions.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Per-note micro-tuning (cent offset)',
    description: 'A ±50-cent float field independent of semitone pitch, applied as a frequency offset at playback for synth-track notes (ui/src/audio/engine.ts); NOT yet wired for instrument/SoundFont-track notes (WorkletSynthesizer\'s pitch-bend is channel-wide, a bigger lift than this pass\'s scope — see phase-22-stream-ad.md\'s Result section). GUI: editable via the per-note inspector panel.',
    core: 'partial', cli: 'done', gui: 'done', status: 'progress',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-22-stream-ad.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Clip-view playhead tracks actual song playback',
    description: 'The clip editor\'s playhead div already existed but compared the ABSOLUTE song-timeline step against the clip\'s own local length — correct only in plain loop mode; in song mode it went out of visible range within a few bars and never tracked the clip actually being edited. Fixed to resolve whether the open clip is the one currently playing (same scene/section lookup engine.ts\'s contentOf uses) and, if so, render the correctly clip-relative, tiled position; renders no playhead at all when the open clip isn\'t the one playing, rather than a nonsensical position.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-cg.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Clip view: note-name readout',
    description: 'The pitch axis showed position on the keyboard strip but no readout of actual note names. Added a readout (real note names, e.g. "C4, E4, G4", not MIDI pitch numbers) for the current selection or the whole visible clip, next to the existing per-note inspector panel.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-cf.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'GUI Quantize',
    description: 'A complete, tested backend (`quantizeNotes`, src/core/edit.ts:390-466) already wired to `beat quantize` (CLI) and `beat_quantize` (MCP) — but grepping `NoteView.tsx` confirms zero button, shortcut, or panel control calls it anywhere. Ableton dedicates four entry points to quantize (record-time, drag-to-grid, a dedicated MIDI Tool panel, `Ctrl/Cmd+U`) — more surface area than any other single operation in ch.11. Add a Quantize control group to `PitchTimePanel` (NoteView.tsx:1105-1223): grid-size dropdown, amount slider (0-100%), starts/ends checkboxes, wired through the existing `POST /pitch-time` route with a new `quantize` op. No new core primitive, no format change — the single cheapest, highest-value item in the whole MIDI-editing comparison.',
    core: 'done', cli: 'done', gui: 'missing', status: 'progress',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Copy/duplicate notes (+ basic clipboard)',
    description: 'A full read of `src/core/edit.ts` finds `addNote`/`removeNote` but no duplicate-in-place or clipboard concept anywhere — dotbeat\'s piano roll cannot duplicate a note or phrase today without manually re-typing coordinates via the CLI. Ableton: `Ctrl/Option`-drag copies instead of moving, addable mid-drag (manual ch.10 p.247). New `copyNotes`/`duplicateNotes` in `src/core/edit.ts` (thin wrapper on `addNote`, fresh ids, `start` offset); in `NoteView.tsx`, Alt/Cmd-held-at-drag-start commits via the duplicate primitive instead of `commitMove`; a plain `Cmd/Ctrl+C`/`+V` clipboard reuses the same primitive.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Split / Chop / Join for MIDI notes',
    description: '`edit.ts` has `splitAudioClip` for audio regions only — no equivalent exists for `note`/`hit` lines. Ableton: `Ctrl/Cmd+E` splits at an arbitrary point; Chop divides selected notes into 2-64 equal grid-aligned parts (manual ch.10 pp.250-252, ch.11 pp.283-284 for the richer Gaps/Emphasis/Variation shaping). New `splitNoteAt`/`chopNotes`/`joinNotes` in `src/core/pitchtime.ts` (same file/shape as the six shipped ops); Chop reuses the existing `ratchetSlots` spacing math already proven by Consolidate.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Clip-level time-structure ops (Crop/Duplicate/Delete/Insert Time)',
    description: 'Ableton\'s Crop Clip, Duplicate Time, Delete Time, Insert Time are whole-clip-timeline edits, distinct from ordinary note Cut/Copy/Paste (manual ch.10 pp.272-274, ch.6 p.166). Today "make room for 4 bars in the middle of a clip" requires manually re-typing every affected note/hit\'s `start` via the CLI. New primitives in `src/core/edit.ts`/`pitchtime.ts`: shift every `note.start`/`hit.start` past a cut point by the inserted/removed span (notes/hits already store literal `start`, so this is mechanically "add K to every start >= cut point"), with a `loopBars`-aware clamp.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Velocity Randomize / Ramp toolbar (Deviation trails as its own field)',
    description: 'Ableton\'s Velocity Editor always shows three sliders alongside the plain drag lane: Randomize [amount], Ramp [start][end], Deviation [range] (manual ch.10 pp.263-265). dotbeat\'s velocity lane (NoteView.tsx:999-1025) supports only single-bar drag. Randomize and Ramp are pure functions over a selection\'s `velocity` (no format change, cheap); Deviation needs a new `velocityRange` field plus a per-pass reroll — architecturally identical to `chance.ts`\'s `chanceFires` model, copy that pattern rather than inventing a new one.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Deactivate / mute a note (third state, distinct from delete)',
    description: 'Ableton: the `0` key mutes a note in place — grayed out, doesn\'t play, stays in the clip — a distinct state from active/deleted (manual ch.10 p.249). dotbeat\'s `removeNote`/`postEdit` with an empty value only ever deletes; there\'s no "keep it but silence it" state. Add `active: boolean` to `BeatNote` (default true, canonically elided); reuse the existing `.chancy` dimmed-render CSS treatment for `active === false`; bind the `0` key in the existing keyboard handler next to Delete/Backspace.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/57-ableton-vs-dotbeat-editing-midi.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'One-click Humanize inside the Pitch & Time panel',
    description: 'The primitive (`beat_humanize`, src/core/humanize.ts) already exists and ships in the "Vary / audition loop" area\'s audition/Keep/Undo flow, but Ableton keeps a plain one-click Humanize button living in the same selection-transform panel as Transpose/Invert/Legato (manual ch.10 pp.207-210) — dotbeat has no equivalent same-panel affordance next to `PitchTimePanel`\'s other one-shot ops. Add a "Humanize" button + amount field to `PitchTimePanel` (NoteView.tsx:1105-1223), calling the same op through `POST /pitch-time`. Cheapest item on this list relative to value — the hard part (the algorithm) is already done.',
    core: 'done', cli: 'done', gui: 'missing', status: 'progress',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Live loop-range capture during audition + loop brace draggable on both edges + keyboard nudge',
    description: 'Ableton: playing a clip then clicking "Set Loop Position"/"Set Loop Length" moves the loop boundary to the current playback position — a direct "capture what I\'m hearing right now" workflow (manual ch.8 p.194); the loop brace itself drags on either edge plus a real keyboard vocabulary (arrows nudge by grid, Ctrl+arrows shorten/lengthen) (manual ch.8 pp.213-214). dotbeat\'s clip-loop handle only drags the end (NoteView.tsx\'s own comment says so explicitly) and has no live-capture or keyboard-nudge affordance at all. Read the live `currentStep` during audition and write through the same `postEdit(\'<path>.loop\', ...)` the drag handle already uses; render a second handle at the loop\'s start.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Consolidate naming collision — rename the ratchet-baking button',
    description: 'dotbeat\'s piano-roll "Consolidate" button (pitchtime.ts\'s `consolidateRatchets`, bakes a ratchet into discrete notes) collides in name with Ableton\'s real, differently-scoped Consolidate (`Ctrl/Cmd+J`, combines several adjacent clips into one new saved clip, manual ch.6 p.167). Nearly free: rename to "Bake Ratchets" in UI copy before the real Ableton-style arrangement-level Consolidate is ever built, so two unrelated commands never ship under the same name.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Ornament (Flam, Grace Notes) + Span articulation modes (Tenuto/Staccato + Offset/Variation)',
    description: 'Ableton\'s MIDI Tools Transform panel: Flam inserts one extra note before each selected note (Position/Velocity); Grace Notes inserts several equal-length notes (Pitch high/same/low, Position, Velocity, per-note Chance) — a total gap today for drum-flam programming and melodic ornamentation alike (manual ch.11 pp.291-293). Span currently only has dotbeat\'s Legato mode; Tenuto and Staccato (half the smallest inter-onset gap) plus Offset/Variation params are missing (manual ch.11 pp.298-299). New functions in `src/core/pitchtime.ts`, same shape as the six shipped ops — Flam/Grace share an insertion helper; Span extends `legatoNotes` with an `articulation` enum.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/58-ableton-vs-dotbeat-midi-tools.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Stacks-style chord/progression generator with diffable JSON chord banks',
    description: 'Ableton\'s Stacks device generates chords/progressions via a Tonnetz chord-selector pad, root/inversion/per-chord duration (manual ch.11 pp.310-312) — notably, custom chord banks are themselves "text files that define specific chord rules in the JSON format," i.e. Ableton independently chose diffable-text-as-content here. `generateStacks` in a new `src/core/generate.ts`, chord-shape table following `SCALES`\'s existing literal-named-table pattern, user-overridable via a project-relative JSON file mirroring `presets/factory.json`\'s tooling-not-grammar precedent (D9).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/58-ableton-vs-dotbeat-midi-tools.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Velocity Shaper (deterministic drawn-envelope velocity contour)',
    description: 'Ableton\'s Velocity Shaper (Max for Live, bundled) shapes selected notes\' velocities against a hand-drawn breakpoint envelope — click to add points, drag to reshape — with Min/Max clamps and a Loop count (manual ch.11 p.305). dotbeat\'s `humanize.ts` only does random Gaussian velocity jitter; no deterministic shaped envelope exists for crescendo/accent design, a real, currently-unaddressed use case. New breakpoint-envelope primitive (`shapeVelocity`) plus a GUI breakpoint-editor widget — the main cost driver is the new widget, not the core logic.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/58-ableton-vs-dotbeat-midi-tools.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Time Warp (breakpoint tempo-curve stretch)',
    description: 'Ableton\'s Time Warp remaps a 1-3 breakpoint speed curve onto a time selection (accelerando/ritardando), generalizing simple uniform stretch (manual ch.11 pp.302-303). dotbeat\'s `timeScaleNotes` (the ×2/÷2 buttons in `PitchTimePanel`) only does a single uniform factor — no curve. Generalize `timeScaleNotes`\'s single `factor` to accept a 1-3-point breakpoint curve, reusing the existing anchor-and-remap logic.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/58-ableton-vs-dotbeat-midi-tools.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Rhythm generator (richer per-lane step pattern than Euclidean)',
    description: 'Ableton\'s Rhythm tool is a step-pattern generator for one pitch/drum pad at a time, meant to be layered voice-by-voice: Steps, Pattern, Density, Step Duration, Split (probabilistic step-subdivision), Shift, Velocity + Accent (manual ch.11 pp.306-308) — richer shaping than a Euclidean generator alone. Sequence directly after the Euclidean/Seed/Recombine generators (below) prove the `src/core/generate.ts` pipeline; don\'t build both simultaneously.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/58-ableton-vs-dotbeat-midi-tools.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Groove extraction from real clips → named, reusable template',
    description: 'Ableton can extract timing/volume information from any audio or MIDI clip into a new groove (manual ch.14 p.334, via a clip\'s own right-click "Extract Groove(s)"). dotbeat\'s `groove.ts`/`humanize.ts` both *generate* deviation from a formula (a Möbius curve, seeded Gaussian) — neither *reads* timing/velocity data from an existing clip, the load-bearing gap in dotbeat\'s groove story. New `extractGroove`/`applyGroove` in `src/core/groove.ts`, same document→document one-shot shape as `humanize()`, storing a named bundle in a new `presets/grooves.json` (D9\'s "tooling, never grammar" precedent).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/59-ableton-vs-dotbeat-grooves.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Groove Commit — bake a live shuffled shape into literal note/hit positions',
    description: 'Ableton\'s Commit button "writes" the Groove Pool\'s current effect into the clip permanently — after Commit the live relationship ends (manual ch.14 p.333). dotbeat\'s shuffle is always computed at playback/read time by design; there is no way to freeze a currently-shuffled shape into literal `note.start`/`hit.start`, e.g. before further manual per-note dragging. `beat groove bake <file> <track>`: rewrite every note/hit start via the already-exported, already-tested `warpStep()` (src/core/groove.ts), then reset `shuffleAmount`/`shuffleGrid` to their defaults, eliding both — idempotent, reuses proven math, no new grammar.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/59-ableton-vs-dotbeat-grooves.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Clip offset / nudge / scrub during audition',
    description: 'Ableton\'s Nudge Backward/Forward jumps a currently-playing clip\'s position; a scrub control repeatedly re-triggers a small chunk (manual ch.16 pp.349-350). Stripped of live-performance framing this is a plain authoring convenience — "jump into the middle of a currently-playing preview" — and dotbeat already has the exact UX pattern shipped one screen over: `ArrangementView.tsx`\'s click-to-seek (`engine.seek(bar)`). Wire the same pattern into `NoteView.tsx`\'s grid during "Preview clip" audition, scoped to the audition\'s own tiled loop range.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/60-ableton-vs-dotbeat-launching-clips.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Generative note tools: Euclidean rhythm + Seed random-note + Recombine (`varyArrange`) generators',
    description: 'dotbeat has zero generative note-creation primitives today. Ableton\'s Generate panel ships Euclidean (up to 4 voices, per-voice rotation, manual ch.11 pp.312-314), Seed (independent pitch/duration/velocity range sliders, scale-aware, manual pp.308-309), and Recombine (Shuffle/Mirror/Rotate permutation of Position/Pitch/Duration/Velocity across a selection, re-rolled every Apply, manual pp.295-297). Euclidean and Seed land in a new `src/core/generate.ts` (Bjorklund\'s algorithm; range-based random, ship v1 against `fitToScaleNotes`\'s existing `SCALES` table as an explicit per-invocation root+scale param rather than waiting on the Scale Mode field above); Recombine is structurally a variation generator, not a deterministic edit, so it belongs in `src/vary/vary.ts` as `varyArrange` — a rung-2-`varyFeel` sibling feeding `beat score`\'s existing ranked-pick flow. All three plug into the existing `beat vary`/`beat score` CLI/MCP/scoring flow with no GUI required to ship value.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/58-ableton-vs-dotbeat-midi-tools.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Browsable groove library + Hot-Swap live audition',
    description: 'Ableton\'s "Grooves" is a first-class content-browser category listing `.agr` files with a Hot-Swap toggle that steps through every candidate while the clip keeps playing (manual ch.14 pp.330-331). Sequenced on groove extraction (above) shipping first — once `presets/grooves.json` exists, add a `grooves` section to `ContentBrowser.tsx` reading it the same way it reads `presets/factory.json`; Hot-Swap extends the existing preview-before-load family (`engine.previewSynthPreset` et al.) with `engine.previewGroove`.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/59-ableton-vs-dotbeat-grooves.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Global Amount master groove-intensity dial + velocity-invert',
    description: 'Ableton\'s Global Amount scales Timing/Random/Velocity for every active groove at once (0-130%), mirrored into the Control Bar; the Groove Pool\'s Velocity slider also runs negative to invert a captured groove\'s velocity profile onto the target clip (manual ch.14 pp.332-333). Not worth building until multiple tracks are commonly sharing one extracted groove — when it is, a one-shot `beat groove scale-all <file> <factor>` batch-edits every track\'s `shuffleAmount`, and velocity-invert becomes a `--velocity-invert` flag on `beat groove apply`, both riding the groove-extraction primitive above.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/59-ableton-vs-dotbeat-grooves.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Clip Groove pool (named per-clip groove templates, hot-swap, commit-to-envelope)',
    description: 'Ableton\'s Groove Pool is per-*clip*, not per-track: a swappable, named groove template (hot-swap from the browser, a Commit button that "writes" the groove and — for audio — converts velocity data into a real volume clip envelope, manual ch.8 pp.195-196). dotbeat has only the track-level parametric pair `shuffleAmount`/`shuffleGrid` — no per-clip template library, no hot-swap, no commit-to-envelope mechanic. Bigger than it looks: needs a `presets/grooves.json`-style library plus a per-clip `groove?: string` reference resolved through the same track-level shuffle math rather than a second warp system.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: '"Set Length" / "Add Interval" ops in Pitch & Time panel',
    description: 'Ableton\'s Pitch and Time Utilities panel includes "Set Length" (snap selection to an exact chosen duration) and "Add Interval" (duplicate the selection at a fixed interval) alongside Transpose/Invert/Legato (manual ch.8 pp.207-210). dotbeat\'s current op set has no absolute-duration-set op and no interval-duplicate op. Two small additions to `src/core/pitchtime.ts` alongside the existing six ops, surfaced as two more `PitchTimePanel` buttons — same shape as the Humanize wiring above, lower value.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Scrub area + Follow-pause-on-edit during audition',
    description: 'Ableton: click-and-hold to repeatedly re-play a chunk (real scrubbing at fine quantization), plus a Follow toggle that auto-pauses the instant an edit is made (manual ch.8 pp.211-213). dotbeat\'s "▶ Preview clip" is play/stop only, no scrub gesture, and there\'s no Follow-style auto-scroll-then-pause-on-edit behavior in NoteView. Scrub: a pointer-drag-and-hold gesture on the clip-loop strip or grid that repeatedly re-triggers `engine.auditionClip` at a small offset, quantized to the grid. Follow-pause: track "last edit timestamp" in local state and suppress auto-scroll for N ms after any edit.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },

  // ── Drum programming ─────────────────────────────────────────────────────
  {
    area: 'Drum programming', feature: 'Open per-track lane model + 12-lane GM-aligned default kit',
    description: 'v0.10: an open, declared, ordered lane list per drum track (synth:<voice>/sample/sf backings), layered additively alongside the legacy closed-5-lane mechanism so every pre-v0.10 file parses and re-serializes byte-identically. kit-808/kit-909 (synth) + kit-acoustic (SoundFont, MuldjordKit) ship in presets/drum-kits.json; `beat add-track --kind drums` defaults to the 12-lane kit going forward. Phase 23 Stream BB closed the GUI gap: a Lanes panel in the drum Clip View (NoteView.tsx) materializes a legacy 5-lane kit into the open model, then adds/reorders/retypes lanes and edits per-lane synth/sample/sf backing params (new core primitives addLane/removeLane/moveLane/setLaneBacking/setLaneParam, POST /lane).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/19-drum-voice-expansion.md', plan: 'phase-23-stream-bb.md',
  },
  {
    area: 'Drum programming', feature: 'Optional per-hit duration field',
    description: 'One optional trailing duration token on hit lines, elided when absent (byte-identical for every pre-existing file); the lane\'s backing decides release (synth/SF) vs. truncation (sample) semantics. `beat add-hit`/`beat set <track>.hit.<id>.duration` and the GUI\'s drag-to-resize both write it.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/20-drum-clip-editor-redesign.md', plan: 'phase-22-stream-ab.md',
  },
  {
    area: 'Drum programming', feature: 'Unified drum clip editor',
    description: 'NoteView generalized behind a row-axis adapter (rowCount/rowLabel/rowOfValue/valueOfRow) — melodic tracks keep the unchanged pitch adapter, drum tracks get a named-lane adapter over the kit\'s declared lanes. A durationless hit renders as a marker; dragging its edge creates a duration (marker -> bar). Soft grid-snap by default, Alt/Cmd freehand bypass. StepSequencer.tsx retired (deleted, no second permanent editor).',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/20-drum-clip-editor-redesign.md', plan: 'phase-22-stream-ab.md',
  },
  {
    area: 'Drum programming', feature: 'Choke-group handling (hat pair)',
    description: 'A closed-hat hit silences a ringing open hat (declared-lane kits only, keyed by canonical lane name) — release for synth/SF voices, stop for sample players.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/19-drum-voice-expansion.md', plan: 'phase-22-stream-ab.md',
  },
  {
    area: 'Drum programming', feature: 'Drum-sampler voice type (sample + AHD envelope + filter + playback effects)',
    description: 'Ableton\'s Drum Sampler bundles a real sample-backed voice with an AHD-ish envelope, one filter, and a short list of dedicated playback effects (Stretch/Pitch Env/Punch/8-Bit/FM/Ring Mod/Sub Osc/Noise) — distinct from today\'s all-procedural-synth drum lanes (manual ch.30 pp.691-695). Independently named in `docs/decisions.md`\'s Tier 2 sound-quality strategy as "the biggest single \'video game music\' tell left." Add a `sample`-backed lane envelope/filter/playback-effect param set riding the existing `setLaneParam` primitive the v0.10 open lane model already uses for synth-backed lanes — scoped to Drum Sampler\'s leaner surface (Start/Length/Gain, one AHD-ish envelope, one filter, a short playback-effect list), explicitly not Ableton\'s full multisampling Sampler stack.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Round Robin sample playback',
    description: 'Ableton\'s Sampler cycles through N samples per repeated trigger, for de-robotifying repetitive drum patterns (manual ch.30 §30.10.5.1, p.737). No dotbeat equivalent at any layer (drum lanes, instrument tracks, or the variation loop). Low cost once any sample-slot drum voice exists (the Drum-sampler voice type row above): cycle through N registered samples per lane keyed by a simple hit counter, no new format concept beyond an array of sample refs per lane instead of one. Not worth building standalone before that lands.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Named, general choke groups',
    description: 'Ableton: any chain assignable to 1-of-16 named choke groups (manual ch.24 p.471). dotbeat\'s `chokeDeclaredLane` (ui/src/audio/engine.ts:2118, call site 2640) is hardcoded to the hat→openhat pair only — real but narrower parity, already flagged as an anticipated gap in phase-22-stream-ab.md\'s own scope notes. Add `choke?: string` to `BeatDrumLaneDecl`, elided when absent; replace the hardcoded `lane === \'hat\'` check with "find other lanes sharing this lane\'s choke group id, stop/release them."',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Per-lane volume + pan',
    description: 'Ableton\'s Drum Rack chain volume/pan sliders are first-class, same rank as devices (manual ch.24 p.465). dotbeat has neither a top-level lane `gain` nor any `pan` field — only `BeatLaneSampleBacking.gainDb`, which is backing-specific, not lane-wide (confirmed: no lane-level Panner/gain wiring on the lane-dispatch path in `ui/src/audio/engine.ts`). Add `gain: number` (dB, default 0) and `pan: number` (-1..1, default 0) as top-level fields on `BeatDrumLaneDecl`, sibling to `backing`; wire into the lane trigger path via a per-lane `Tone.Panner` + level multiplier. Directly closes a gap `ROADMAP.md`\'s Format v0.3 section has flagged open since the M3 session.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Per-lane sends to a shared kit-level return bus',
    description: 'Ableton\'s Drum Racks get up to six return chains fed by per-chain send sliders (manual ch.24 p.472). dotbeat has only track-wide `sendReverb`/`sendDelay` — no per-lane send and no shared drum-bus return concept. Sequence after per-lane volume/pan lands (needs the same fine-grained per-param lane edit path plus a new shared-return-bus concept with no current per-track analog) — not a small increment.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Per-voice mute/solo + auto-highlight the sounding lane',
    description: 'Ableton: every Drum Rack chain row carries its own Solo + Mute, plus Auto Select auto-highlights whichever chain is currently sounding (manual ch.24 pp.465-467). dotbeat has track-level mute/solo only — confirmed no lane-scoped mute/solo primitive exists. Extend the existing transient, session-only mute/solo pattern (ui/src/state/store.ts, already deliberately kept out of the .beat file) down to lane granularity, plus a "currently sounding" highlight in the Lanes panel keyed off the same trigger path `previewDrum`/`triggerDrum` already share.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Extract a drum lane to its own track (`beat extract-lane`)',
    description: 'Ableton can extract a chain (with its devices and, for drum chains, its MIDI/hit data) to its own track (manual ch.24 pp.479-480). A pure compound edit over primitives that already exist: `addLane`/`removeLane`/`moveLane`/`setLaneBacking` plus `addTrack` — new track with one lane copying the source\'s backing, move every referencing `hit` line by id, remove the source lane. Has a tedious manual workaround today; ship once per-lane volume/pan lands (shares its lane-primitive surface).',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Rack/chain-level mixer strip (lanes visible in the mixer)',
    description: 'Ableton\'s Rack chains appear alongside tracks in the mixer, full mixing/routing controls mirrored live with the chain list (manual ch.24 pp.478-479). Extend `MixerView.tsx` to optionally expand a drum track into its declared lanes as sub-strips (gain/pan + mute/solo, both above) — a natural follow-on once both exist, not a standalone build.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },

  // ── Arrangement / song structure ────────────────────────────────────────
  {
    area: 'Arrangement / song structure', feature: 'Section CRUD + loop→song conversion',
    description: 'Append/resize/delete song sections; a loop-mode project can grow into a full multi-section song.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-19-arrangement-length.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Drag the rightmost loop boundary directly',
    description: 'Resize the loop by dragging its edge on the timeline instead of using +/- controls. Extending outward (not just shrinking) needed a render-time preview at a frozen px/bar plus edge auto-scroll, since the timeline is normally fit-to-width — the gap Phase 19 explicitly deferred.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-22-stream-ag.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Independent per-section scene editing (Insert Scene + Capture-and-Insert Scene)',
    description: 'Today, appended sections share the source scene; editing one edits them all. Ableton solves this with two commands: Insert Scene (a blank, independent, empty scene inserted at a position) and Capture-and-Insert Scene (snapshot whatever\'s currently live into a brand-new scene, no audible interruption) — manual ch.7 p.182. Phase 26 Stream DJ shipped both: core\'s `insertScene`/`songInsert` (src/core/edit.ts) mint a fresh scene id and splice a new section at a chosen index — never reusing an existing scene, so a new section can\'t inherit another\'s content; `sceneFromLiveContent` (src/daemon/daemon.ts, previously invoked only once internally at loop→song conversion) is now generalized into `captureAndInsertScene`, a repeatable POST /song {op:\'captureInsert\'} route. Both are wired into ArrangementView.tsx as "+ insert scene"/"+ capture scene" buttons next to "+ section". `beat song-insert`/`beat_song_insert` cover the CLI/MCP surface for the empty-scene half only — Capture-and-Insert Scene has no CLI/MCP verb yet (daemon/GUI only). Verified end-to-end (`ui/verify-phase26-stream-dj.mjs`): a genuinely new empty scene with zero cross-contamination of sibling sections, and a captured scene whose clips match live content exactly at capture time.',
    core: 'done', cli: 'partial', gui: 'done', status: 'progress',
    research: 'research/54-ableton-vs-dotbeat-session-view.md', plan: 'phase-26-plan.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Clip-level loop/length/time-signature properties',
    description: 'Ableton’s Start/End/Loop/Position/Length/Signature clip panel. v0.10 format addition (BeatClipLoop/BeatTimeSignature — a clip-local bar-range override + metadata-only time signature). Phase 22 Stream AG shipped the format/GUI (a properties strip in the Clip View, free CLI/MCP access via the existing generic beat set / beat_set path) but left the loop range engine-unwired — every clip still tiled at the document-wide loop_bars period regardless. Phase 24 Stream CJ wired the loop range into actual playback (ui/src/audio/engine.ts’s contentOf now tiles within a clip’s own [loop.start, loop.end) when set) and added a drag-handle resize affordance in the Clip View. Time signature remains metadata-only — the engine is still constant-tempo 4/4.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-24-stream-cj.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Overlapping-region resolution policy (clip / push / keep-existing)',
    description: 'A user-configurable preference for what happens when two regions/sections overlap, push direction always downward, never cascading. "keep-existing" ("don\'t disturb my arrangement") is a real, non-obvious default worth having once dotbeat\'s section model needs overlap semantics. Reimplemented for dotbeat\'s 1D section-list timeline (no independently-positioned regions): only growing a non-last section can conflict with anything. A GUI/session preference (like openDAW\'s own Preferences->Editing setting), not project content, so it is not a .beat format field. The CLI\'s `beat song` is whole-list replace and has no equivalent single-section-resize verb, so there is no CLI collision scenario to wire.',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-22-stream-ag.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Drag a section to reorder it',
    description: 'Repositioning a song section in the sequence (distinct from resizing its length). New `songMove` core primitive (a real splice-based reorder, diffed as one clean fact — not a delete+insert pair), `beat song-move`/`beat_song_move` CLI/MCP, and native-HTML5-drag-and-drop on the section-chip row (with ◀/▶ button fallbacks for accessibility).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-cb.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Visualize clips in the arrangement + cross-track select/move',
    description: 'Clip occurrences on a synth/drum/instrument track\'s row were previously invisible (no bounded block, no label) — only audio-kind tracks had a canvas-drawn hint. Added a bordered, labeled DOM block per occurrence on every track kind, then a marquee/rubber-band multi-select across track rows and drag-move of the whole selection together (preserving relative section offsets). Moving a selection clones a private per-section scene when the source section\'s scene is shared with untouched siblings, so a move never bleeds into content it shouldn\'t touch.',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: 'research/30-ableton-clip-visualization.md', plan: 'phase-24-stream-cc.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Timeline zoom + bar-number ruler',
    description: 'The arrangement timeline was always fit-to-container-width with no independent zoom and no per-bar tick numbers (only per-section labels). Added zoom in/out/fit controls plus Cmd/Ctrl+scroll-wheel zoom (pointer-anchored), real horizontal scrolling once zoomed past the viewport, and numbered bar ticks reusing the existing note/hit density threshold rather than a second zoom-level concept.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-cd.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Loop a selected range + click-ruler-to-seek',
    description: 'Playback always looped the full song/loop with no way to audition just one section, and clicking the ruler only started a bar-range selection, never seeked the playhead. Added a session-only loop-region override (reuses the existing bar-range selection axis, e.g. a section chip\'s "loop this" toggle) that engine.ts\'s tick() wraps within instead of the full song, plus Ableton-style click-to-seek (click while stopped starts playback there, click while playing just relocates). Found and fixed a real Tone.js bug along the way: a stale Draw-callback could survive stop() and stomp the next play()\'s position.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-ce.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Audition a clip being authored, independent of song position',
    description: 'A clip open in the note/clip editor was completely inaudible unless it happened to already be the one playing via the current song position — no preview mechanism existed at all. Added a "Preview clip" control that plays the open track\'s content in isolation (true solo — every other track silenced for the duration), mutually exclusive with normal playback.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-ch.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Place an authored clip into the arrangement (first placement)',
    description: 'Phase 23 Stream BC solved "drag it into the arrangement" for audio clips only (a content-browser file drop); synth/drum/instrument clips authored directly in the note editor had no placement mechanism at all. Generalized BC\'s pattern: a "Place in Arrangement" button that snapshots the track\'s live content into a clip (core\'s saveClip) and slots it into the first song section\'s scene (setScene), reusing the existing occurrence in place on a second click rather than minting a duplicate.',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-24-stream-ci.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Two independently-adjustable clip regions: Start/End (playable) vs. Loop (repeating)',
    description: 'Ableton models "the section that plays when launched" (Start/End, with Set-buttons) separately from "the section that repeats" (Loop Position/Length) — enabling a pickup/intro that plays once before the clip runs into a loop (manual ch.8 pp.193-194, 214). `BeatClipLoop` is a single range today; dotbeat\'s playable region and repeating region are definitionally identical — the sharpest finding of the clip-view comparison. Real format decision: a second `play: {start,end} | null` range on `BeatClip`, defaulting to the loop range when absent (canonical elision preserved); a second numeric field pair in `ClipPropertiesPanel.tsx` and a second drag strip above NoteView\'s grid.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Clip rename (distinct from id)',
    description: 'Ableton: "renaming an audio clip does not rename the referenced sample file" — clips carry an independent display name (manual ch.8 p.188). `BeatClip` has only `id`, no `name`. One-line format addition: `BeatClip.name?: string`, canonically elided when absent; a text input in `ClipPropertiesPanel.tsx`\'s toolbar strip (currently a static `clip "${clip.id}"` label) and in the "Placed (clip ...)" button\'s title. Cheap, high-legibility win once a track has more than one or two clips.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Group Track slot shading (collapsed-group content summary)',
    description: 'Ableton shows a shaded cell colored by the left-most contained clip when a Group Track collapses, with its own launch/stop control (manual ch.7 p.174 screenshot). dotbeat\'s `GroupHeaderRow` (ArrangementView.tsx:1121-1173) already has the collapse mechanic but `arr-group-lane` renders empty on collapse — zero summary signal today. Add a lightweight per-section indicator on the collapsed group row: filled/colored whenever any member track has a clip occurrence in that section, colored by the first (in track order) populated member\'s track color — reuse the per-occurrence block geometry already established for ungrouped tracks.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/54-ableton-vs-dotbeat-session-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Scene Tempo / Scene Time Signature overrides',
    description: 'Ableton\'s Scene View carries Tempo/Signature sliders per scene (manual ch.7 pp.176-178). This is the one item in ch.7 that is not actually a performance-surface artifact — it\'s a per-section-of-timeline data override, and `BeatTimeSignature`\'s own doc comment already names the exact gap ("engine still constant-tempo 4/4 only"). Add an optional `tempo?: number` to `BeatSongSection`, following the exact canonical-elision pattern used everywhere else (absence = inherit `doc.bpm`); wire into the engine\'s section-transition logic; surface as a per-section-chip field the same way `BeatClipLoop`\'s drag-handle already exposes clip-level loop range.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/54-ableton-vs-dotbeat-session-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Follow (auto-scroll to playhead during playback)',
    description: 'Ableton\'s Control Bar switch auto-scrolls the Arrangement to the playhead, with a precise pause/resume state machine: pauses on any edit, manual scroll, or ruler click; resumes on stop/restart or a click back in the timeline (manual ch.6 p.153). dotbeat has a live playhead div but nothing scrolls the viewport to follow it. Add `followEnabled: boolean` next to `loopRegion` in `ui/src/state/store.ts`; scroll `scrollRef.current` to keep the playhead in view; pause on any drag/resize/postEdit call, resume on transport stop/restart or a ruler click.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Zoom-to-selection (`Z`/`X`) + zoom-history stack',
    description: 'Ableton: one key fills the viewport with exactly the current bar-range selection; a second key reverts, repeatably, through prior zoom levels (manual ch.6 p.153). dotbeat\'s `zoomPxPerBar` state already has everything except this specific action and a history stack. Extend the existing `zoomIn`/`zoomOut`/`zoomFit` trio with a `zoomToSelection()` computing `pxPerBar` from the current selection, plus a small array-backed undo stack in local component state pushed before each zoom change.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Arrangement-level keyboard shortcuts (spacebar play/stop, `0` deselect, arrow-nudge, split/consolidate)',
    description: 'Ableton specifies an extensive shortcut vocabulary at the arrangement level: spacebar play/stop, `Ctrl/Cmd+E` split, `Ctrl/Cmd+J` consolidate, `R` reverse, `0` deselect, arrow-key nudge (manual ch.6 pp.153-165). `ArrangementView.tsx` has no global keydown listener at all today (only local Enter/Escape inside rename inputs) — play/stop is button-only, with no spacebar binding, a real basic gap. New keydown listener scoped to `ArrangementView`, same idiom `NoteView.tsx` already uses (guard against focus in inputs).',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Ordinary clip Cut/Copy/Paste/Duplicate (selection-scoped)',
    description: 'Ableton\'s baseline selection-scoped editing verbs (manual ch.6 pp.164,166). No `duplicateClip`/`copyClip`/`pasteClip`/`cutClip` primitive exists anywhere in `src/core/edit.ts` — the only thing resembling "duplicate" is the "+ section" button, which duplicates a whole section\'s content, not an arbitrary clip. New primitives alongside `saveClip`/`setScene`; clipboard lives in daemon/GUI state, not the file. Given dotbeat\'s section-shared-scene model, scope this to "duplicate/copy this clip\'s content into a new clip, slotted into a chosen section" rather than an arbitrary free-floating region move.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Split generalized to synth/drum clips',
    description: 'Ableton\'s split (`Ctrl/Cmd+E`) works on both audio and MIDI clips via one uniform command (manual ch.6 p.166). dotbeat\'s only split primitive, `splitAudioClip`, is audio-region-only — there\'s no equivalent for a `BeatClip` on a synth/drum track. New `splitClip` in `src/core/edit.ts`, generalizing `splitAudioClip`\'s existing pattern — trim the first clip\'s bar range, mint a second with an adjusted start, partition any clip-scoped automation points by time.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Overview strip (minimap) + secondary wall-clock ruler',
    description: 'Ableton: a whole-arrangement thumbnail with a draggable viewport rectangle, plus an independent minutes-seconds-milliseconds ruler below the track list (manual ch.6 p.150-152). Confirmed absent from dotbeat (zero minimap/overview hits) — zoom+scroll exists but no whole-song thumbnail and no wall-clock time axis (bars-only). New `OverviewStrip.tsx`: a fixed-width scaled rendering above `.arr-ruler-row`, with a draggable viewport rectangle bound to scroll state; wall-clock ruler computes bar→seconds from `doc.bpm`, scroll-only.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Locators (lightweight named point markers)',
    description: 'Ableton: named, freely-positioned rehearsal marks in the scrub area, independent of any clip/section boundary, with Previous/Next navigation (manual ch.6 pp.155-157). dotbeat\'s closest analog (a named song section) is structural, not a free-floating point marker. Do not build the full Session-launch-quantization machinery — just a plain named point + jump: new `BeatMarker { id, name, bar }[]` on `BeatDocument`, a thin row below the ruler, click-to-seek via the existing `engine.seek` call.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Time-signature markers, engine-interpreted (mid-song meter changes)',
    description: 'Ableton: Insert Time Signature Change placeable anywhere, including off-barline positions that create a fragmentary bar with its own reflow recovery operations (manual ch.6 pp.157-159). dotbeat\'s `BeatTimeSignature` is explicitly clip-local metadata only — the engine is still constant-tempo 4/4, "modeled and round-tripped but NOT yet interpreted." Needs a document-level marker list plus real interpretation in the engine\'s scheduler, plus the two fragmentary-bar recovery operations. Sequence together with arrangement-wide "…Time" commands below — both need the same "does this bar boundary fall inside an existing clip" primitive.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Tempo changes over time (tempo ramp/automation)',
    description: 'dotbeat\'s `bpm` is a single global scalar with no ramp or marker at all — a distinct, deeper gap from time-signature markers above even though they look similar. Natural fit: reuse the existing `BeatAutomationLane`/point grammar with `bpm` as an automatable target, read by the engine\'s tempo path. Not blocked on the time-signature-marker work; sequence independently.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Arrangement-wide "…Time" commands (Cut/Paste/Duplicate/Delete Time, Insert Silence)',
    description: 'Ableton: insert-or-remove-a-bar-range operations that shift every track simultaneously, reflowing any time-signature markers inside the affected span too (manual ch.6 p.166). No dotbeat equivalent at any grain finer than a whole section. New `insertTime`/`deleteTime` primitives in `src/core/edit.ts`, scoped to `doc.song`, shifting every affected track\'s clip occurrences and in-range automation points — bigger lift than clip-level time-structure ops (Note editing area), sequence right after that since both need the same bar-boundary logic.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Reverse audio clip',
    description: 'Ableton\'s Reverse Clip(s) (`R`) reverses a selection of audio material across multiple clips at once (manual ch.6 p.165). The only "reverse" in dotbeat is `reverseNotes`, which reverses note/hit positions on a track, not audio-buffer samples — no audio-buffer reversal exists anywhere in `ui/src/audio`. New `reverseAudioClip` in `src/core/edit.ts` (a clip-level flag, mirroring `reverseNotes`\'s pattern but for the referenced audio buffer) plus actual buffer-reversal support in the `Tone.Player` playback path.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Real Consolidate (multi-clip arrangement-level fold, distinct from ratchet-baking)',
    description: 'Ableton\'s Consolidate (`Ctrl/Cmd+J`) combines several adjacent clips, per track or across tracks, into one new saved clip (manual ch.6 p.167) — a real, unbuilt feature on its own merits distinct from the ratchet-baking button of the same current name (see the naming-collision row in Note editing). New `consolidateClips` primitive in `src/core/edit.ts`, built on the existing `saveClip`/`setScene` pair: fold N adjacent section occurrences on one or more tracks into one new saved `BeatClip`.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Per-track height / unfold + Optimize Height/Width',
    description: 'Ableton: manual resize of a track\'s row to reveal more waveform/MIDI detail, `H`/`W` shortcuts to fit all tracks to the view (manual ch.6 p.152,164). `ROW_H` in dotbeat is a single fixed 56px constant applied to every row — no per-track resize exists. A per-track `rowHeight` map in local `ArrangementView` state; a drag handle on `.arr-track-header`\'s bottom edge. Distinct from the piano-roll\'s "Fold mode" row — don\'t conflate the two.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: '"Consolidate Time to New Scene" (snapshot a bar range across all tracks into fresh clips)',
    description: 'Ableton: select an Arrangement time range, consolidate to one new clip per track, deposit into a new Session scene (manual ch.7 p.184). The destination half (a Session scene) is moot for dotbeat, but the underlying primitive — "snapshot every track\'s content across a bar range into a fresh, independently-editable clip set" — is a generically useful authoring convenience (e.g. turning an improvised passage into a reusable pattern). Needs a naming pass first — `beat consolidate` is already taken by the ratchet-to-discrete-notes verb.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/54-ableton-vs-dotbeat-session-view.md', plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Per-clip mute (Clip Activator) + per-clip color override',
    description: 'Ableton: the `0` key or a title-bar toggle mutes one clip independent of track mute; a per-clip color override plus bulk "Assign Track Color to Clips" (manual ch.8 pp.187-188). dotbeat has track-level mute only and every clip visually inherits its track\'s color unconditionally — no `active`/`color` field on `BeatClip`. Both gated on multi-clip-per-track landing first (today\'s one-clip-per-track-per-scene model makes "mute just this clip" and "color just this clip" low-value); add `active?: boolean` and `color?: string` to `BeatClip` once that lands.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },

  // ── Synth sound design ──────────────────────────────────────────────────
  {
    area: 'Synth sound design', feature: 'Full grouped synth param panel',
    description: '~54-field SYNTH_FIELDS across osc/filter/envelope/inserts/sends, exposed in one grouped GUI panel.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-13-editing.md',
  },
  {
    area: 'Synth sound design', feature: 'Real wavetable oscillator',
    description: '`wtPos`/`wtTable` are live fields an LFO can even target (synthParams.ts:130-131), but `OscType` is sine/tri/saw/square only (engine.ts:311) — `wtPos` is a dead knob, dotbeat\'s single sharpest, lowest-ambiguity gap versus Ableton\'s Wavetable instrument (manual ch.30 pp.775-779). A small table-per-category library matching the existing 4-value `wtTable` enum, linear-interpolated scan across `wtPos`, as a `PolySynth`-compatible custom oscillator (or an `AudioWorkletProcessor` if per-frame `PeriodicWave` regen proves too costly for live scanning). Land as a new `OscType` value so it inherits existing envelope/unison/LFO plumbing for free, rather than a parallel oscillator bank.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Mono/Legato voice mode + per-instrument polyphony limit/glide',
    description: 'Every dotbeat oscillator layer is independently a `Tone.PolySynth` (engine.ts:2169-2186) — no mono/legato concept exists anywhere. Ableton\'s Drift/Operator both offer a true monophonic Mode with legato (overlapping notes retrigger pitch only, envelope doesn\'t restart, manual ch.30 p.690,725) — named the single most-requested-feeling patch-character gap in the instrument comparison. Add a `voiceMode` enum (`poly`/`mono`/`legato`); worth doing properly via a real note-tracking suppression of envelope retrigger in the scheduler (`tick()`, ~engine.ts:3040-3055), not just capping `maxPolyphony` to 1 (which loses true legato).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Envelope loop modes (Loop/Trigger/Beat/Sync)',
    description: 'dotbeat\'s ADSR (attack/decay/sustain/release + parallel filterEnv*) is a strict one-shot every time, no loop-mode enum. Ableton\'s Loop/Trigger/Beat/Sync (or AD-R/ADR-R/ADS-R) rhythmic/looping envelope behavior while a key is held is the chapter\'s single most-repeated convention, appearing on 5+ instruments (manual ch.30, Analog p.671, Operator p.732, Sampler pp.743,749, Wavetable pp.780-781). `envLoopMode` enum reusing the existing tempo-sync machinery already built for LFOs (`LFO_SYNC_RATES`) — mostly wiring, not new DSP.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'FM fixed-frequency mode + FM self-feedback',
    description: 'dotbeat\'s FM layer exposes only `fmHarmonicity`/`fmModIndex`/`fmLevel` (synthParams.ts:142-144) — no fixed-frequency mode and no self-feedback. Ableton\'s Operator: fixed-frequency oscillators (ignore note pitch, play a constant Hz — inharmonic/metallic/drum FM) and oscillator self-feedback (an unmodulated operator modulates itself for noisier/richer single-op tones) are both named, real controls (manual ch.30 §30.9.2.3, §30.9.10.6, pp.719,731). `fmFixed`/`fmFixedFreq` fields for the former; a small feedback gain patched into the FM layer\'s own modulator input for the latter (Tone.FMSynth has no native feedback param, so this needs either dropping to the lower-level oscillator API or a near-zero-delay `Tone.FeedbackDelay` as a cheap stand-in).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Stereo voice mode (fixed hard-L/R, zero detune)',
    description: 'Ableton\'s Drift Mode chooser includes a dedicated Stereo mode — 2 fixed voices hard-panned L/R, no detune, cheaper than unison (manual ch.30 p.690). dotbeat\'s stereo width for a voice only comes from continuous `unisonVoices`≥3 panning, no zero-detune stereo-only mode. Reuse the existing `osc2Pan`/`osc3Pan` panner infrastructure at fixed hard-L/R rather than adding new nodes; likely shares an enum field with the mono/legato voice-mode row above.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Named unison algorithms beyond continuous voices/width',
    description: 'Ableton\'s Wavetable offers 6 named unison algorithms (Classic/Shimmer/Phase Sync/etc.), each a qualitatively different stacking behavior (manual ch.30 p.783). dotbeat\'s unison is one fixed algorithm (4 hardcoded detune-ratio pairs) that only scales in voice count/width — real parity in spirit, different shape, and not urgent since the continuous model already covers most practical ground. If picked up, cheapest first target is "Shimmer" (randomized per-voice pitch jitter) as a small addition to the existing `uniPairs` detune-ratio table.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Dual/parallel/split filter routing',
    description: 'dotbeat has exactly one filter shared unconditionally by every oscillator layer (engine.ts:2198-2205). Ableton\'s Wavetable/Analog/Meld offer 2 filters per voice with independently-routable oscillators (series/parallel/split, manual ch.30 pp.672-673,778-779,713). Bigger lift than the wavetable oscillator itself — a second `Tone.Filter` instance plus a `filterRouting` enum, straightforward once the wavetable oscillator and multi-osc layer count are stable, not before.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Multi-operator FM with selectable algorithms (Operator-style)',
    description: 'dotbeat\'s FM is one fixed layer mixed additively into the osc bank (engine.ts:2186) — no algorithm concept exists. Ableton\'s Operator ships 4 operators and 11 selectable routing algorithms (manual ch.30 §30.9, pp.716-717). A genuine rewrite of the FM layer, not a param addition — 2-4 independently-tunable operators with a selectable routing graph, replacing the current single `Tone.FMSynth` with a custom operator graph (Tone\'s built-in only does 2-operator FM). Sequence after the wavetable oscillator — don\'t compete for the same design-and-review cycle.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'Per-voice analog-modeling randomization ("Drift" knob)',
    description: 'Ableton\'s Drift instrument\'s signature control: subtle per-voice pitch/cutoff jitter at note-on, distinct from unison detune (manual ch.30 p.690). dotbeat\'s oscillators are perfectly deterministic; no jitter/randomization field exists. Cheap once picked up: one `voiceDrift` knob (0-1) applying small per-voice-instance jitter, seeded like the existing seeded-RNG conventions (`chance.ts`\'s mulberry32) so renders stay reproducible. Real character-adding value for analog-feel patches, no roadmap pressure naming it yet.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },
  {
    area: 'Synth sound design', feature: 'MPE (MIDI Polyphonic Expression) support',
    description: 'Several Ableton instruments are explicitly MPE-capable (Analog, Drift — manual ch.30 pp.665,683), enabling a continuous per-note pitch-bend/pressure/timbre channel. dotbeat has no MPE concept anywhere (`BeatNote` has only discrete `pitch`/`velocity`/`chance`/`cent` fields) and no real MIDI hardware input capture path exists yet. Gate behind real MPE-hardware usage showing up as a request and a MIDI-input capture path landing (neither exists today) — a speculative build otherwise. Multiple chapters (57, 58, 68) independently flag MPE-dependent features and independently decline to scope them ahead of real demand.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },

  // ── LFOs / modulation ────────────────────────────────────────────────────
  {
    area: 'LFOs / modulation', feature: '16-destination tempo-synced LFOs',
    description: 'Two LFOs per track, 16 possible destinations, real tempo sync — deliberately literal/enumerated, not a free-routing matrix.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-18-lfo-depth.md',
  },
  {
    area: 'LFOs / modulation', feature: 'Per-parameter velocity/key modulation, generalized',
    description: 'Today exactly two hardcoded single-destination knobs exist: `velToFilterAmount` and `keytrackAmount`, both cutoff-only (engine.ts:~3049-3055). Ableton\'s instruments carry per-parameter Velocity/Key modulation sliders on nearly every knob, not just filter/amp (manual ch.30, Analog pp.667-669, Operator 9 instances in one instrument pp.729-731, Tension pp.765-769). Extend the existing "flat enum of named destinations + one amount slider" pattern already proven twice for `LFO_DESTS` (synthParams.ts:82-98,172-190) to a `velDest`/`velAmount` and `keyDest`/`keyAmount` pair reusing the same destination list. Lands in the same per-note dispatch block that already computes `keytrackMult`/`velMult`, generalized to a destination switch. The single largest modulation-flexibility gap named across the instrument comparison, and architecturally cheap given the LFO precedent.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/68-ableton-vs-dotbeat-instrument-reference.md', plan: null,
  },

  // ── Instrument / SoundFont tracks ───────────────────────────────────────
  {
    area: 'Instrument / SoundFont tracks', feature: 'Playback, program select, meters, mute/solo',
    description: 'SoundFont-backed instrument tracks with program selection and real audio-gated mute/solo.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-14-instrument-tracks.md',
  },
  {
    area: 'Instrument / SoundFont tracks', feature: 'Instrument-track + drum-bus reorderable FX chain parity',
    description: 'Ableton\'s device-chain rule is stated flatly: MIDI effects → instrument → any number of audio effects, same as an audio track from that point on (manual ch.3 pp.46,53). `InstrumentPanel.tsx` renders only a program picker plus two Knobs (volume, pan), no effect chain at all (confirmed: 192-line file, no EffectChain usage) — the one place dotbeat\'s current model visibly deviates from Ableton\'s own stated device-chain rule, not just an incomplete feature. Drum tracks have the identical asymmetry: `BeatTrack.effects` (src/core/document.ts:708-712) is synth-tracks-only, and drum buses get a fixed insert order outside the reorderable list (`ui/src/audio/engine.ts:1493-1494`\'s own comment: "v0.10\'s effects field is synth-tracks-only"). `reconcileEffectChain`/`buildEffectRuntime`/`EFFECT_TYPES` are already fully generic — the type-level restriction is the only thing narrowing it. Widen to instrument AND drum tracks in one pass rather than fixing instrument tracks alone and leaving drum tracks asymmetric with no principled reason; render via `InstrumentPanel.tsx` reusing `SynthPanel.tsx`\'s `EffectChain` UI.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/50-ableton-vs-dotbeat-live-concepts.md', plan: null,
  },
  {
    area: 'Instrument / SoundFont tracks', feature: 'One-shot sampler instrument track kind',
    description: 'A lean sampler instrument (volume, sample, release, pitch-tracking — 3-4 literal fields) as a track kind distinct from the implicit "every track is a synth" assumption. Explicitly the right-sized alternative to Ableton\'s full multisampling Sampler stack (key/velocity zones, dedicated Zone Editor view, manual ch.30 §30.10, pp.734-738) — if multisampling depth is ever wanted, extend this leaner one-shot sampler with key-range zones incrementally rather than building a Zone Editor from scratch (research/68).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/21-opendaw-devices-effects.md', plan: null,
  },

  // ── Mixer ────────────────────────────────────────────────────────────────
  {
    area: 'Mixer', feature: 'Inline strip + full-screen overlay',
    description: 'Per-track header mixer strip plus an on-demand all-strips overlay; real audio-gated mute/solo.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-16-instrument-mixer.md',
  },
  {
    area: 'Mixer', feature: 'Persisted mute/solo representation',
    description: 'Decided, deliberately, to stay transient (ui/src/state/store.ts) — NOT a gap. Real DAWs (Ableton, Logic) treat mute/solo as session/monitoring state, not composition data; dotbeat already applies the identical rule to BeatGroup.collapsed (src/core/document.ts) for the same reason; and the .beat format\'s premise is a diff that means something musically (decisions.md) — soloing a track while arranging shouldn\'t leave a line in every commit. Nothing added to BeatTrack; the decision (and its reasoning) lives as a doc comment on store.ts\'s mutes/solos fields.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-23-stream-bb.md',
  },
  {
    area: 'Mixer', feature: 'Peak metering + per-effect chain-row level meter',
    description: 'dotbeat\'s `TrackMeter` (MixerView.tsx:93-123) reads `engine.getTrackLevel`, which is RMS-only (confirmed: no peak segment, no sticky "went over 0dB" marker anywhere). Ableton shows peak AND RMS simultaneously, plus resettable peak indicators (manual ch.18 p.381-383). Two independently-reported symptoms converge on the same fix: "not clear if effects are doing anything" (research 63, per-device meters) and a headroom bug that was invisible on an RMS-only meter (research 61, mixer peak metering) — the crest-factor collapse `docs/volume-fader-bugfix.md` found was close to invisible without this. Add a peak segment (short-window max, e.g. last 100-300ms) alongside the existing RMS bar in `TrackMeter`, plus a sticky reset marker; extend the same tap pattern to a per-effect level indicator on each `EffectRow` (SynthPanel.tsx:94-163), keyed by `BeatEffect.id` off whatever node `reconcileEffectChain` spliced in.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'General-purpose Group Track / submix bus (real audio summing + shared FX)',
    description: '`BeatGroup` (src/core/document.ts:725-737) is a flat, named, colored membership list with zero audio-engine presence — `engine.ts` contains no reference to `BeatGroup` at all. Ableton\'s Group Track is "a special kind of summing container": any set of tracks grouped into one with its own mixer strip and hostable FX chain, auto-routing members\' output into it (manual ch.18 pp.384-386). The drum bus already proves dotbeat\'s engine can build exactly this kind of submix (shared filter→EQ3→comp→dist→bitcrush→sends→fader, engine.ts:1804-1847) — generalize that proven pattern into a per-`BeatGroup` bus: route member tracks\' panner/muteGain output into a group-owned `Tone.Gain` instead of straight to `getMaster()`, reusing the existing `effects`/`reconcileEffectChain` machinery for the group\'s own insert chain. Needs a mixer-strip UI for the group (fader + FX badges, same `ChannelStrip` shape).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'User-editable master-bus EQ/compression',
    description: 'dotbeat\'s master chain is entirely fixed: `Tone.Gain(1)` → `Tone.Limiter(-1)` → destination (engine.ts:1722-1738) — no user-facing master EQ/comp exists anywhere in the GUI. Ableton lets users drag effects onto the Main track to process the mixed signal before output, "usually compression and/or EQ" (manual ch.18 p.387) — the traditional lever for exactly the "master sounds hot/pumping" symptom this research effort was partly commissioned to investigate. Sequence as the first slice of the already-planned learned-auto-mix/master-bus-EQ-DRC work (ROADMAP.md §7, Diff-MST), scoped down to one always-present EQ3+comp on the master strip, user-editable via a new Master strip in `MixerView.tsx`.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Multi-select "adjust one, adjust all, preserve relative offsets"',
    description: 'Ableton: selecting several tracks and dragging one\'s volume/pan moves all of them together, keeping existing differences intact (manual ch.18 p.381,384). dotbeat\'s `ChannelStrip` has no multi-select concept — every fader/pan/send edit is scoped to exactly one track. A workflow nicety once multi-track selection exists elsewhere in the GUI — reuse the arrangement view\'s existing cross-track marquee-select rather than inventing a second selection state.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Split Stereo Pan Mode + click/double-click reset gesture',
    description: 'Ableton: independent L/R pan sliders as an alternative to the single Stereo Pan knob, toggled via context menu, double-click to reset (manual ch.18 p.382). dotbeat\'s pan is a single -1..1 Knob with no mode switch and no reset gesture. Small, well-specified addition: a context-menu toggle swapping the knob for two independent L/R sliders, plus a reset-to-center double-click regardless of mode.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Resizable mixer strip: tick marks + dB scale on the fader track',
    description: 'Ableton: dragging the mixer taller/wider progressively reveals tick marks, resettable peak indicators, and a decibel scale (manual ch.18 pp.382-383). dotbeat\'s `Fader` is fixed-height with a single 0dB marker line, no tick marks, no dB scale. Companion to the peak-metering work above — once `TrackMeter` grows a peak segment, add static CSS-positioned tick labels (-60/-48/-36/-24/-12/-6/0/+6) along the fader track (no resize interaction needed, dotbeat\'s fixed-width strip doesn\'t need Ableton\'s resize-to-reveal space-saving).',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'N user-creatable return tracks with hostable FX (vs. today\'s 2 fixed buses)',
    description: 'dotbeat has exactly two, fixed, un-editable buses: `reverbBus` and `delayBus`, built once in `getBuses()` (engine.ts:1766-1772), with no user path to add a third, remove one, or drop an insert effect onto either. Ableton: "you can create multiple return tracks using the Create menu\'s Insert Return Track command," each with its own arbitrary device chain (manual ch.18 p.387). Real gap, but dotbeat\'s 2 fixed sends already cover the dominant real-world use case — only worth the real engineering (a new `BeatReturn` document type, a general effects-chain-hostable bus, a return-track mixer strip) once a user actually wants a third custom send bus.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Exclusive-solo-by-default convenience',
    description: 'Ableton: a single click solos exclusively unless Ctrl/Cmd is held, or "Exclusive Solo" is turned off globally (manual ch.18 pp.391-392). dotbeat\'s `toggleSolo` (store.ts:167) has no exclusive-by-default behavior — every toggle is independent. A genuinely two-line change: gate `toggleSolo` behind a modifier-key check in the solo button handler. Worth doing on its own even at this priority — cheap, decoupled from the (out-of-scope) cueing half of the same manual section.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Per-track Track Delay (ms offset)',
    description: 'Ableton: a millisecond offset (or pre-delay) per track to compensate for real-world monitoring/hardware/acoustic latency, distinct from automatic plug-in delay compensation (manual ch.18 p.393). Genuinely useful once dotbeat has real monitoring/recording latency to compensate for, but meaningless before that — sequence directly after (not ahead of) the already-flagged M4 native-latency-compensation work.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Per-track CPU/performance indicator',
    description: 'Ableton\'s Performance Impact per-track CPU meter (manual ch.18 p.394). A reasonable, cheap, low-priority GUI nicety independent of recording — cross-references the already-listed "GUI spectrum / level visualization" gap (same "visualize existing engine data, no new judgment surface" shape, doesn\'t reopen D2\'s "LLM narrates, never judges alone" decision).',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/61-ableton-vs-dotbeat-mixing.md', plan: null,
  },
  {
    area: 'Mixer', feature: 'Deeper per-track Limiter access (Auto Release, True-Peak)',
    description: '`this.masterLimiter = new Tone.Limiter(-1)` (engine.ts:1726) is master-bus-only and ceiling-only. Ableton\'s real Limiter offers Link (L/R vs M/S), Maximize mode, Auto Release, 3 lookahead times, and Standard/Soft-Clip/True-Peak ceiling modes, plus per-track access as an ordinary insert (manual ch.28 pp.587-588). `Tone.Limiter` wraps a `DynamicsCompressorNode` internally with no true-peak oversampling — real True-Peak mode needs either oversampled peak detection (AudioWorklet-tier) or accepting Standard-mode-only parity. Gated on real need; defer to a dedicated mastering-tier pass.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },

  // ── Core effects ─────────────────────────────────────────────────────────
  {
    area: 'Core effects', feature: 'EQ3 / comp / distortion / bitcrush / reverb+delay sends / sidechain',
    description: 'The built-in insert set every synth and drum bus already carries.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-13-editing.md',
  },
  {
    area: 'Core effects', feature: 'Ordered, reorderable per-track effect chain',
    description: 'Replaced the fixed EQ→comp→dist→bitcrush insert order with an explicit ordered list of effect lines (format v0.10) — flat literal text (order = line order, stable per-instance ids), never a pointer/index indirection like openDAW\'s box graph uses. Add/remove/reorder/bypass a built-in insert per track; bypass is a real routing bypass, not a mix-knob illusion. Two independently-parameterized instances of the SAME type remain out of scope (documented) — new effect TYPES (Ping Pong Delay/Beat Repeat/Chorus/Saturator) are a separate stream to reconcile at merge time.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/21-opendaw-devices-effects.md', plan: 'phase-22-stream-aa.md',
  },
  {
    area: 'Core effects', feature: 'Compressor Knee',
    description: 'Ableton\'s Compressor exposes a Knee knob with a live Transfer Curve display (manual ch.28 p.547 screenshot). `DynamicsCompressorNode` (which `Tone.Compressor` wraps) already exposes a native `.knee` property — near-free. One new `SynthFieldDef` near `compMix` (document.ts), one wiring line (`compressor.knee.value = p.compKnee` in engine.ts near line 640), one knob in synthParams.ts\'s `comp` group. No new Tone.js primitive needed.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Device A/B compare',
    description: 'Ableton: every built-in device stores two parameter-value states, A and B — changes apply only to A, Compare copies A to B (manual ch.23 pp.437-439). dotbeat has no equivalent at any layer — no A/B slot on `BeatEffect`/`BeatSynth`. Given D9\'s "no in-file indirection" principle and the mute/solo precedent, a strong candidate for session-only UI state (not a `.beat` field) — an A/B compare choice is a workflow aid, not a compositional decision worth a git diff line. Scope to synth-track `EffectRow`s first; defer automation-disable-on-switch (Ableton\'s trickiest wrinkle) since dotbeat\'s automation model is per-track-param, not per-device-state.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Hot-swap-in-place (replace a chain member\'s type, keep its position)',
    description: 'Ableton\'s Hot-Swap can replace a device mid-chain via the browser, keeping chain position (manual ch.23 p.442). dotbeat\'s `PresetPicker` covers preset-browsing but has no equivalent for swapping a device TYPE mid-chain (e.g. replacing a `comp` row with an `eq7` row in place) — today that\'s remove-then-add-at-end, which loses position. New `postEffectReplace(trackId, effectId, newType)` daemon route: remove+insert at the same index, same "one clean fact" shape as `songMove`. GUI: a small "swap" affordance on `EffectRow` opening the same `EFFECT_TYPES` picker the add control already uses.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Multiple independently-parameterized instances of the same effect type',
    description: 'Ableton\'s chain is an unbounded ordered list — nothing stops two Auto Filters or two EQ Eights on one track. dotbeat\'s existing "Ordered, reorderable per-track effect chain" row explicitly documents this as a current-scope cut. Dropping the implicit one-per-type assumption needs auditing wherever the daemon keys effect lookup by type rather than instance id, plus the harder part: `synthParams.ts`\'s `PARAM_GROUPS`/`effectType` gate assumes one group per type — a second instance needs per-instance knob groups, not per-type ones. Real engineering lift; sequence behind metering (Mixer area) per research 63.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },

  // ── Extended FX arsenal ──────────────────────────────────────────────────
  {
    area: 'Extended FX arsenal', feature: 'Ping Pong Delay',
    description: 'A hand-built two-delay-line network (not the plain Tone.PingPongDelay built-in, which hardwires 100% cross-feedback with no dial) as a per-track insert — pingPongTime/Feedback/Mix plus continuously-variable pingPongCrossFeed and delay-time LFO wobble (pingPongWobbleRate/Depth, research 21 row 4) rather than a binary ping-pong toggle.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Beat Repeat',
    description: 'Grid/gate/chance/mode stutter-repeat — scheduling-layer note/hit re-triggering in engine.ts\'s tick() (not a Tone.js audio node, per research 17 §4.3), with a per-note-position-seeded RNG for the chance roll (research 21 row 5) so re-renders are bit-for-bit reproducible.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Expose Chorus-Ensemble / Phaser-Flanger as a per-track insert',
    description: 'Retired the old shared, un-configurable chorusBus/phaserBus/sendMod mod-send machinery; chorusMode (off/chorus/ensemble/vibrato)/chorusRate/Depth/Mix and phaserRate/Depth/Mix are now real per-track inserts, same one-instance-per-track precedent as EQ3/compressor.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Saturator',
    description: 'Tone.WaveShaper-based character saturation with an analog/warm/clip/fold curve family (authored once per curve CHANGE, not per sample) and a drive-controlled pre-gain into the shaper.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: '7-band parametric EQ',
    description: 'HP/LP (selectable slope 12/24/48/96 dB/oct + Q) + 2 shelf bands + 3 parametric bell bands (freq/gain/Q each), each of the 7 independently enabled via its own on flag (no shared "neutral value = off" trick — HP/LP have no true no-op frequency). New EffectType \'eq7\', additive to Phase 22 Stream AA\'s reorderable per-track chain; built entirely on Tone.Filter (covers both the HP/LP rolloff-cascade half and the native peaking/lowshelf/highshelf types research 17 flagged as two separate halves).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-bd.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Auto Filter / Auto Pan / Tremolo',
    description: 'Dedicated Ableton-named devices — thin wrappers around Tone.AutoFilter/AutoPanner/Tremolo, ADDITIVE entries in the same reorderable effect chain (autoFilter/autoPan/tremolo EffectType members), each with its own Rate/Depth/Mix (Tremolo also Spread). The shared LFO destination matrix already covers the sonic capability; the value here is Ableton-authentic naming and a third, independent modulation source, not new sound.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-be.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Redux (downsampling half)',
    description: 'A new bitcrushRate field on the EXISTING bitcrush type (not a new EffectType) — Ableton\'s own Redux is one device, two dimensions, and bit-reduction already owned bitcrush\'s bit-depth half. A hand-built sample-and-hold decimator (raw ScriptProcessorNode; Tone.js has no built-in Rate/Jitter node), gated by the SAME bitcrushMix as bit-depth reduction — one shared dry/wet knob for the whole device.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-be.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Utility (stereo width / gain trim)',
    description: 'Near-free via Tone.StereoWidener (utilityWidth, 0=mono/1=max stereo/0.5=neutral default) plus a static utilityGain dB trim — a mixing-hygiene tool, not a sound-design reach. No Mix field (like eq3, the chain\'s per-instance bypass is its only "off").',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-be.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Grain Delay',
    description: 'A hand-built granular pitch-shifting delay — Tone.Delay + Tone.Gain feedback + Tone.PitchShift (Tone.js\'s own internal granular pitch-shift algorithm, exposing a real windowSize grain-size control) in one feedback loop, so every repeat is both re-granulated and re-pitched (cumulative shimmer). A real EffectType chain member (unlike Stream AC\'s fixed inserts), synth tracks only.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-bf.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Vinyl Distortion',
    description: 'Tone.WaveShaper asymmetric tape/record-style soft-clip saturation + a seeded, reproducible surface-noise/crackle bed (a hand-generated buffer via a streaming mulberry32 PRNG, not Tone.Noise — which has no public seed API and would make renders non-reproducible) plus a tone-tilt filter.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-bf.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Resonators',
    description: 'A bank of 5 tuned Tone.Filter bandpass nodes (fifths/major/minor/octaves/harmonic interval sets around a root frequency, Q as the ring/decay proxy) approximating physical resonance — the closest a plain biquad filter bank gets without Corpus\'s AudioWorklet-tier custom DSP.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-23-stream-bf.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Corpus',
    description: 'Resonant-body physical-modeling effect — no Tone.js primitive gets close; AudioWorklet-tier custom DSP, lowest priority.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Gate',
    description: 'dotbeat\'s only "sidechain" concept today is `duckSource`/`duckAmount` (document.ts:299-300) — a scheduled volume dip synced to a source track\'s kick-lane hits, not a real audio-triggered envelope follower (engine.ts:3389-3402: "not an audio-analysis sidechain... dips this track\'s volume whenever duckSource\'s kick lane has a hit at this step"). Ableton\'s Gate (manual ch.28 pp.573-575) is a full Threshold/Return/Attack/Hold/Release/Floor noise gate with a Flip (duck) mode and full EQ\'d external sidechain — independently the sharpest single finding of two research passes (48 then 67). New `EffectType: \'gate\'` built from `Tone.Follower` driving a `Tone.Gain` via threshold comparison, same pattern the codebase already uses for `duckAmount`\'s scheduled envelope but continuous/audio-rate. Self-sidechain-only v1 (real audio-triggered cross-track sidechain is a stretch goal, not required — already closes most of the everyday-use gap).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Plain tempo-synced Delay insert',
    description: 'dotbeat only has the two specialized delays (Grain Delay, Ping Pong Delay) — no plain synced delay insert exists, distinct from the shared reverb/delay send buses. Ableton\'s base Delay device: plain tempo-synced/free stereo delay, per-line filter, LFO on time+filter, 3 time-change smoothing modes (manual ch.28 pp.556-559). New `EffectType: \'delay\'` using `Tone.FeedbackDelay` (already proven for the shared `delayBus`) wired as a genuine per-track insert — own node instance per track, `delayTime`/`delayFeedback`/`delayFilterFreq`/`delaySync` fields, `delayTime` expressible as a tempo-synced division reusing the `LFO_SYNC_RATES` enum pattern.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Real per-track Reverb insert (replacing the single shared hardcoded bus)',
    description: 'dotbeat\'s reverb is `Tone.Reverb({decay:2.2, wet:1})` (engine.ts:1768) — one hardcoded shared instance, decay only, no per-track insert, no IR import. Ableton\'s real Reverb/Hybrid Reverb: input filter, early reflections with Spin, full diffusion network, internal chorus, Freeze/Flat/Cut, optional convolution IR import (manual ch.28 pp.608-611, 580-586). New `EffectType: \'reverb\'` using `Tone.Reverb`\'s existing `decay`/`preDelay` params plus a new `reverbColor` (simple input-filter tilt) — closes most of the "shallow reverb" gap without chasing Hybrid Reverb\'s convolution-IR complexity. dotbeat\'s current shared reverb is real and usable, just shallow — sequence behind Gate/Delay/Knee, which close more everyday gaps per build-hour.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Bass Mono on the existing Utility insert',
    description: 'dotbeat\'s Utility (Tone.StereoWidener + Tone.Volume, `utilityWidth`/`utilityGain`) covers 2 of Ableton\'s 9 Utility controls. Ableton\'s real device also has Bass Mono with its own Audition solo-the-lows toggle, Mid/Side mode, per-channel phase invert, Channel Mode, Mono switch, Balance, Mute, and a DC offset filter (manual ch.28 p.645 screenshot). Bass Mono is the cheapest genuinely-new-DSP item: `Tone.Filter` lowpass split path below a `utilityBassMonoFreq` cutoff, summed to mono via a `Tone.Gain`-based mid-channel merge, recombined with the already-widened highs.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Ring modulation (Shifter\'s ring-mod mode, as its own standalone effect)',
    description: 'Ableton\'s Shifter unifies pitch-shift/frequency-shift/ring-modulation in one device (manual ch.28 pp.624-628); dotbeat has no true multiplicative ring mod anywhere (autoFilter/tremolo/phaser don\'t cover this territory). New `EffectType: \'ringMod\'`, named standalone rather than folded into a 3-in-1 Shifter design to match dotbeat\'s existing one-effect-one-job convention (resonator/grainDelay are already split out rather than merged). `Tone.Gain` whose `.gain` is driven by an audio-rate `Tone.Oscillator` — true multiplicative ring mod, no dedicated Tone.js class needed. Fields: `ringModFreq` (Hz, 1-5000), `ringModMix`.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'EQ7 Adaptive Q + Stereo/L-R/M-S processing modes',
    description: 'dotbeat\'s shipped 7-band EQ (eq7) is a fixed HP+LoShelf+3×Bell+HiShelf+LP topology, mono-summed, with static Q fields. Ableton\'s EQ Eight additionally offers Adaptive Q (Q auto-increases with boost/cut amount for a more analog-consistent curve) and Stereo/L-R/M-S processing modes, plus 2× oversampling and an Audition (solo-a-band) mode (manual ch.28 p.568 screenshot). Adaptive Q needs per-band gain-to-Q coupling logic in the live audio-param update path; Stereo/L-R/M-S needs per-channel-pair filter routing, a bigger lift (splitting the signal path, not just a coefficient) — defer until eq7 usage in practice shows the mono-linked behavior is a real complaint.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Auto Filter envelope-follower section (alongside its existing LFO)',
    description: 'dotbeat\'s `autoFilter*` fields are LFO-only today. Ableton\'s Auto Filter has a full envelope-follower section (Attack/Hold/Release, S&H quantize, sidechain input) driving the filter in addition to the LFO; Auto Pan-Tremolo\'s merged UI also has a Shape control reshaping the LFO waveform continuously between ramp/sine/square, which dotbeat\'s `tremoloRate/Depth/Spread/Mix` has no equivalent of (manual ch.28 pp.519,526). Adding `Tone.Follower`-driven modulation of `autoFilterBaseFrequency` reuses the same `Tone.Follower` primitive the Gate effect (above) would introduce — sequence Gate first and share the envelope-follower code path.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/67-ableton-vs-dotbeat-audio-effect-reference.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Per-device fold/collapse presentation (distinct from bypass)',
    description: 'Ableton: a device can be collapsed by double-clicking its title bar or via the context menu\'s Fold — pure vertical-space management, independent of the Activator toggle (manual ch.23 p.429,434). dotbeat\'s `EffectRow` has no fold state; a row is always shown at full height. Low-stakes on its own, but relevant once per-device metering or A/B compare add more per-row real estate — a `<details>`-style collapse mirroring the existing `Group` component\'s pattern.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Expandable inline device sub-views (frequency curve, filter-sweep display)',
    description: 'Ableton devices like Roar (Gain Stage/Modulation Matrix), EQ Eight (Frequency Display), and Phaser-Flanger (LFO/Envelope-Follower section) offer a bespoke larger visualization panel toggled by an arrow next to the Activator (manual ch.23 pp.434-436). dotbeat\'s `ParamGroup`s are flat knob rows — no device gets a bespoke visualization (e.g. a frequency-response curve for eq7, a filter-sweep display for autoFilter). Real value but a bespoke `<canvas>` per device type, not a metadata-table addition — defer past the general GUI spectrum/level visualization row, which is the more general version of the same rendering investment.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Per-device context menu (rename, duplicate, save-as-default)',
    description: 'Ableton\'s per-device context menu: Cut/Copy/Duplicate/Rename/Group/Fold/"Show Preset Name"/"Save as Default Preset" plus device-specific extras (manual ch.23 pp.436-437 screenshot). dotbeat\'s `EffectRow` exposes exactly two mutating actions (remove, bypass) plus reorder — no menu, no rename, no duplicate. Rename/duplicate are the two with real payoff — duplicating an `EffectRow` (same type, params, new id, inserted after) is a small core primitive; rename needs a new optional label field on `BeatEffect` (a format addition). Cut/copy/paste across tracks and "save as default preset" are lower value given presets-as-tooling (D9) already covers most of that need.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Per-project/new-track default effect chain',
    description: 'Ableton: new MIDI/audio tracks can load with specific devices pre-configured; dropping a sample onto a track has its own configurable default chain (manual ch.23 pp.446-448 screenshot). dotbeat has presets applied on demand but no "new synth track always starts with X" system. `beat init`\'s `initDocument()` already has one obvious hook point — seed new synth tracks with a configurable default chain instead of the hardcoded legacy four. Scope down from Ableton\'s three-tier system to just "per-project new-track default chain, configurable in `presets/`" — matches dotbeat\'s existing presets-are-tooling pattern rather than a new Defaults-folder concept.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },
  {
    area: 'Core effects', feature: 'Chain-list/knob-wall single-row UI unification',
    description: 'Ableton\'s device title bar (chain-membership controls) and its parameter panel (the knobs) are the same visual object, one row in one list (manual ch.23 pp.428-436). dotbeat\'s `EffectChain` list and `PARAM_GROUPS` knob wall remain two separate DOM regions, mitigated since Phase 25 by the `justAdded` scroll-into-view + flash highlight but not eliminated. Full fix (`EffectRow` discloses its own knobs inline, Fold-style) is a bigger interaction-model rewrite of `SynthPanel.tsx` — worth doing once per-device meters and A/B compare (both wanting to live on the row) make the two-region split more obviously wrong, not before.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/63-ableton-vs-dotbeat-instruments-and-effects.md', plan: null,
  },

  // ── Automation ───────────────────────────────────────────────────────────
  {
    area: 'Automation', feature: 'Per-track picker + draggable curve',
    description: 'Pick a track/param, draw breakpoints, playback verified to follow the drawn curve exactly.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-automation-lanes.md',
  },
  {
    area: 'Automation', feature: 'Curved automation segments + exact numeric breakpoint entry',
    description: 'v0.9 is points-only, linear between them; `BeatAutomationPoint`\'s own doc comment says so explicitly (document.ts:442-446). Ableton bows a straight segment via Alt/Option-drag (manual ch.25 p.489) and opens a keyboard-editable numeric field via right-click → Edit/Add Value, shown live as a tooltip while dragging (manual ch.25 p.488) — dotbeat has neither: every segment is linear, and the code already computes `drag.value` during a drag but never renders it (ArrangementView.tsx:1029). Two chapters (65, 55) explicitly recommend shipping these together since both touch `AutomationLane`. Add `interpolation?: \'linear\' | \'hold\' | \'curve\'` to `BeatAutomationPoint`, default `\'linear\'`, elided (D9); Alt/Option-drag on a segment bows it (quadratic bezier toward the drag point is a reasonable first cut), `\'hold\'` needs only a per-point toggle. Alongside it: a right-click numeric `<input>` on a breakpoint, and rendering the live drag value — both essentially free given the data already exists. Prerequisite for every other curve-shaping automation feature (predefined shapes, stretch/skew) below.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Same-row curve overlay',
    description: 'Draw the automation curve directly over the clip row instead of only in a dedicated sub-lane.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/50-ableton-vs-dotbeat-live-concepts.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Automation manual-override suspends (not erases) + Re-Enable Automation',
    description: 'Ableton: nudging an automated control while not recording silently "overrides" it (LED off, plays your manual value); a Control Bar button snaps every overridden control back to what\'s written (manual ch.25 pp.484-485). No mechanism to trigger this exists yet — dotbeat has no live-record-while-playing automation entry point. Parked as a design note until live automation recording exists; when it does, mirror Ableton\'s semantic exactly rather than silently overwriting drawn automation on first touch. dotbeat\'s structurally different safety net (undo/redo, checkpoint/history) already covers "try something, revert" at a coarser, arguably more useful grain in the meantime.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Track/arrangement-scoped automation independent of any single clip (Lock Envelopes equivalent)',
    description: 'Automation is currently scoped to one clip at a time by explicit v0.9 design (document.ts:539-543: "deliberately NOT modeled at the live track / non-clip level") — the picker/curve target only a track\'s first-playing clip. Ableton\'s Automation Envelopes are keyed to Arrangement position (or the Session clip that recorded them), a genuinely separate mechanism from Clip Envelopes, with Lock Envelopes letting a curve stay pinned to song position even as clips underneath it move (manual ch.25 p.492, ch.3 p.57). The single biggest structural automation gap named by two independent chapters — needs its own design pass before building: attach automation at the scene/section slot-mapping level, not the clip object, rather than inventing a second parallel track-level data structure. Don\'t build shape-insertion/stretch-skew automation features against today\'s clip-only model without revisiting this first — every clip-scoping limitation (global-wipe Delete Automation, "first-playing clip only," absent loop-mode automation) traces back to this one root cause.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Log-scale y-axis',
    description: 'Frequency-style params (cutoff, etc.) read better on a log axis than linear.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/50-ableton-vs-dotbeat-live-concepts.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Unlinked clip-envelope loop length (independent of the clip\'s own tiling)',
    description: 'Ableton\'s longest, most novel clip-envelope section (manual ch.26 pp.503-506): a clip envelope\'s own local loop/region length, unlinked from the clip\'s sample loop — enabling a long shape over a short loop, a short rhythmic-gating shape over a long sample, or a hidden-grid unsynced LFO shape, all via one mechanism. `BeatAutomationLane` has no loop-range field at all — a drawn curve is always tiled to the clip\'s own `loopBars*16` period. Additive schema field mirroring the exact `BeatClipLoop | null` pattern already used twice: `loop: {start,end} | null`, absent = today\'s behavior. Engine change is localized to the tiling math already in the automation-read path.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/66-ableton-vs-dotbeat-clip-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Cross-parameter automation copy/paste',
    description: 'Ableton: an envelope\'s copied data can be pasted onto a different parameter\'s lane, deliberately ungated by type compatibility (manual ch.25 p.492). dotbeat\'s `postAutomation` route only ever writes points into the lane the drag originated in — no copy/paste concept for automation exists at all. A keyboard shortcut (Cmd/Ctrl+C on a selected lane, Cmd/Ctrl+V on a target) that copies the source lane\'s points normalized to its own min/max and re-denormalizes into the target param\'s range on paste, writing each point via the existing `setAutomationPoint` primitive — deliberately don\'t gate by type compatibility, matching Ableton\'s own stance.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Automation discovery UI (badge for already-automated params in the picker)',
    description: 'Ableton lights an LED next to any control carrying automation, plus a "Show Automated Parameters Only" filter (manual ch.25 pp.481,485-486). dotbeat\'s already-automated params surface as lanes automatically once the `A` toggle is opened, but there\'s no glance-able badge in the picker itself before opening it. A small dot/badge on picker `<option>`s with a non-empty lane — cheap, iterate `track.clips[0].automation` client-side, no new backend data.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Segment-level selection and drag on automation lanes',
    description: 'Ableton: click near (not on) a segment, or Shift-click on it, to select and drag an entire segment as one object (manual ch.25 p.488). dotbeat has no concept of a "segment" as a selectable/draggable unit — only individual points. A "click near, not on, a point" hit-test tier (between the point-radius hit zone and a wider segment-hit threshold) that selects the two flanking points as a pair, then drags both together. Natural sequel to curved segments since both touch segment identity, not just point identity.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Draw Mode paint-a-run gesture for automation',
    description: 'Ableton has a dedicated Draw Mode where drag-and-paint replaces click-to-place-one-point (manual ch.25 pp.486-487). Don\'t port Ableton\'s separate mode toggle — reuse the pattern already shipped for the per-note chance lane (one continuous drag paints every point the pointer sweeps over), applying the identical drag-paint interaction to the automation canvas. Same visual language the user already learned, far less code than a real mode toggle. Sequence after curved segments and segment-drag land, since Draw Mode\'s main value is far more useful once curves can actually bow.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Simplify Envelope (geometric breakpoint-count reduction)',
    description: 'Ableton: one command algorithmically reduces breakpoint count, replacing redundant points with straight/curved segments that reproduce the same curve within tolerance — framed as the antidote to recorded automation\'s breakpoint explosion (manual ch.25 p.490). Genuinely cheap as a pure geometric reduction over `BeatAutomationPoint[]`, no new format field. Low urgency until live automation recording exists and actually creates a breakpoint-explosion problem to solve — build sooner if manual curve-drawing sessions start producing visibly noisy diffs in practice.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Predefined automation shapes (sine/triangle/ADSR insertion)',
    description: 'Ableton: right-click a time selection to insert one of five periodic waveforms or a linking ramp/ADSR shape, scaled to the selection (manual ch.25 p.491). Sequence strictly after curved segments — the ADSR/ramp shapes are meaningless without curve support. A shape-picker button on the lane header + a pure-function point generator (selection range, param min/max, shape) → points, wired through the existing set-point primitive in a batch.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Stretch/skew a time-selected automation range',
    description: 'Ableton: four corner + four edge-midpoint drag handles on a hovered time selection do vertical stretch (rescale value range), horizontal stretch (time-rescale), and corner-drag skew, with a live rectangle overlay (manual ch.25 pp.489-490). Depends on a lane-local time-selection concept dotbeat doesn\'t have today (the existing `/selection` protocol is track/bar-range at the arrangement level, not lane-local) — build that first, then layer stretch/skew handles on top; skew is directly analogous to segment drag generalized to N points.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/65-ableton-vs-dotbeat-automation-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Sample Offset envelope ("beat scrambling")',
    description: 'Ableton: tape-head-style read-position modulation, ±8 sixteenths, available only in Beats Warp Mode (manual ch.26 pp.497-498). Blocked on dotbeat\'s own beats-mode/complex warp support, which doesn\'t exist yet. Once it does: add `\'sampleOffset\'` to `AUDIO_AUTOMATABLE_PARAMS` — reuses `BeatAutomationLane` completely unchanged; only new work is the engine\'s per-tick read-position offset interpretation.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/66-ableton-vs-dotbeat-clip-envelopes.md', plan: null,
  },
  {
    area: 'Automation', feature: 'MIDI Controller clip envelopes (raw CC data as a drawable envelope)',
    description: 'Ableton exposes raw MIDI CC data (up to controller 119), whether recorded or imported from a `.mid` file, as a drawable envelope (manual ch.26 p.503). Blocked on MIDI import existing at all — dotbeat has no MIDI import path and no CC concept in `BeatNote` whatsoever. Not independently schedulable; revisit only once MIDI file import (File format & core engine area) is scoped.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/66-ableton-vs-dotbeat-clip-envelopes.md', plan: null,
  },

  // ── Versioning / history ────────────────────────────────────────────────
  {
    area: 'Versioning / history', feature: 'git-backed checkpoints, history panel, pin/restore',
    description: 'Explicit checkpoint/history/pin/restore over git — not automatic, deliberately.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-15-history-panel.md',
  },
  {
    area: 'Versioning / history', feature: 'Musical-language git-merge conflict narration',
    description: 'A `beat merge --explain` that narrates a merge conflict in the same phrasing D8 already uses for diffs ("both changed trk_bass.cutoff: 1200Hz vs 800Hz") instead of raw <<<<<<< markers. Reuses D8\'s DiffEntry machinery unchanged. Pairs naturally with a narrower, currently-uncovered sibling: Ableton\'s Merging Sets lets a user drag a whole Set (or unfold it like a folder) to cherry-pick one track/clip/device chain out of another project file (manual ch.5 pp.131-134) — dotbeat\'s equivalent, `beat import-track <source.beat> <track-id> --into <dest.beat> [--as <new-id>]`, is a well-defined text operation given both files share one grammar and stable slugs, more precise than Ableton\'s drag-target ambiguity.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },

  // ── Vary / audition loop ────────────────────────────────────────────────
  {
    area: 'Vary / audition loop', feature: 'Rungs 1–3: vary / score / suggest',
    description: 'Generate parameter variants, audition live, keep or undo; a cold-start recommender picks the next group to try.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-15-vary-affordance.md',
  },
  {
    area: 'Vary / audition loop', feature: 'Rung-2 "feel" content variation, wired into the GUI',
    description: 'A second "≈ vary feel" trigger next to the existing rung-1 affordance (VaryAffordance.tsx), same audition/Keep/Undo shape. Each variant is a full document (humanize rewrites many note/hit fields, not a small edit list) generated by POST /vary-feel (read-only, selection-scoped, reuses varyTrack\'s enforced-scope guarantee) and previewed live via setDoc; Keep resends the variant\'s reproducible seed to POST /vary-feel/commit, which regenerates the identical content deterministically and writes it. Scoring (`beat score`/`beat suggest`) still isn\'t wired to either rung\'s GUI Keep — an honest gap carried forward from phase-15-vary-affordance.md, not closed here.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-23-stream-bb.md',
  },

  // ── Render / export ──────────────────────────────────────────────────────
  {
    area: 'Render / export', feature: 'GUI Export button',
    description: 'Reuses the live engine’s own capture path; verified against the CLI reference render.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-render-export.md',
  },
  {
    area: 'Render / export', feature: 'Per-track stem rendering (`beat render --stems`)',
    description: '`ROADMAP.md` §5 already floats `beat render project.beat -o mix.wav --stems` as a near-term capability, but it doesn\'t exist — `cli/render.mjs`\'s actual arg parser accepts only `-o/--tail/--daemon-port/--preview-port`, no stems flag. Ableton\'s own export matrix treats Main / All Individual Tracks / Selected Tracks Only as first-class render modes (manual ch.5 pp.122-127). Add a per-track solo-render loop (mute every other track, render, repeat) over the existing render path — small, and directly feeds the D2 metrics/lint loop with per-stem signal, not just mix-bus.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },

  // ── Metrics / critique loop ──────────────────────────────────────────────
  {
    area: 'Metrics / critique loop', feature: 'LUFS / spectral / crest / stereo metrics + lint',
    description: 'Agent-facing per decisions.md D2 ("LLM narrates, never judges alone") — no GUI meter display planned, not a gap.',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: null, plan: 'decisions.md',
  },
  {
    area: 'Metrics / critique loop', feature: 'GUI spectrum / level visualization',
    description: 'A real-time FFT/level display reusing the exact spectral data `beat metrics` already computes server-side — a visualization of existing data, not a new judgment surface, so it doesn\'t reopen D2\'s "LLM narrates, never judges alone" decision.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
  },

  // ── Selection protocol ───────────────────────────────────────────────────
  {
    area: 'Selection protocol', feature: 'daemon /selection + --scope selection',
    description: 'A shared selection axis grammar wired into both the arrangement and note views and the CLI.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-13-editing.md',
  },

  // ── Preset / content library ─────────────────────────────────────────────
  {
    area: 'Preset / content library', feature: '36 presets + content taxonomy',
    description: 'Presets are tooling (never in-file indirection); categorized following Ableton’s browsable-kind logic.',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-18-content-taxonomy.md',
  },
  {
    area: 'Preset / content library', feature: 'Content browser sidebar',
    description: 'A collapsible left-sidebar browser (ContentBrowser.tsx) over the real presets/factory.json + presets/kit-*/ + presets/sf2/*.sf2, grouped by Phase 18 Stream S\'s taxonomy. Drag a preset onto a track (core\'s applyPreset — a literal edit list) or a kit sample onto a drum lane (registers into the project\'s own media/ + setLaneSample); a soundfont can also be dropped onto an instrument track or added as a brand-new one.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-ah.md',
  },
  {
    area: 'Preset / content library', feature: 'Hot-swap preset browser in Device View',
    description: 'A preset picker (select + prev/next) inside SynthPanel itself for synth/drum tracks, and a soundfont picker inside InstrumentPanel for instrument tracks — swap without leaving Device View. Both reuse the exact daemon mechanisms the Phase 22 sidebar already established (applyPresetToTrack/installSoundfont — GET /library, POST /library/apply-preset, POST /library/install-soundfont), so this stream added no new daemon surface, only the in-panel pickers.',
    core: 'na', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-23-stream-bb.md',
  },
  {
    area: 'Preset / content library', feature: 'Preview-before-load',
    description: 'Audition a preset/sample/soundfont before applying it — an ephemeral engine voice or a raw fetch-decode-play, real audio through the master bus, with zero writes to the .beat file (engine.previewSynthPreset/previewDrumPreset/previewBuffer/previewSoundfont).',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-ah.md',
  },
  {
    area: 'Preset / content library', feature: 'Live Clip export (clip + full instrument/FX chain, as one portable asset)',
    description: 'Ableton\'s Live Clips: dragging a Session clip to the User Library bundles not just its own settings but the originating track\'s full instrument + effect chain as one portable, reloadable asset (manual ch.5 pp.129-130,58-59). `beat clip export <file> <track> <clip-id> -o snippet.beat` (serializing note/hit content plus the track\'s synth/FX-chain fields as a standalone document) and `beat clip import snippet.beat <dest.beat> <dest-track>` (re-applying via existing edit primitives) — near-free given `.beat` is already stable-ID text (D6), genuinely on-brand since a droppable "clip" stays diff-friendly text unlike Ableton\'s binary-ish `.alc`.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Text search bar with AND-logic',
    description: '"electric bass" should only match items containing both words, force-switching to search-everything scope (manual ch.4 p.63). No search input exists anywhere in dotbeat\'s browser today. Client-side only — `fetchLibrary()`\'s catalog is already fully in memory in `ContentBrowser.tsx`; split the query on whitespace, filter every row list by `.every(term => haystack.includes(term))` over name+category. No daemon route needed.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Filter View: clickable facet chips',
    description: 'Ableton\'s Filter View shows faceted groups (Type, Sounds > Mallets > Pad, Character) as toggleable pill-shaped chips composing with search (manual ch.4 pp.60,72). As a first cut with zero new data: render the existing `category` field as a row of clickable chips above the list (a visual affordance over what `groupByCategory` already computes) — composes with text search. Skip Ableton\'s full per-label-remembered filter-group visibility menu as over-engineering at dotbeat\'s current 36-100 item scale.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Flat tag field on presets + filter integration',
    description: '`BeatPreset` has no tag field at all (src/core/preset.ts:21-36). Ableton\'s Tag Editor has full parent/child tag groups with a dedicated authoring UI (manual ch.4 pp.75-78) — explicitly NOT worth porting at dotbeat\'s scale. Add an optional `tags?: string[]` to `BeatPreset`, populate in `presets/factory.json`, render as small pills under each row feeding into the filter chips above. Trigger to actually build: once the catalog pushes past ~100 items — premature at today\'s 36.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Collections / favoriting',
    description: 'Ableton\'s Collections: 7 fixed color-coded, cross-type, user-curated labels, number-key-assignable to any item (manual ch.4 pp.79-81). No favoriting/starring/coloring mechanism exists for library content in dotbeat today (track header recoloring is a different thing — that colors a project track, not a browsable library item). If built, keep it flat and `localStorage`-based (browsing-session UI state, not the `.beat` file or `presets/factory.json`) rather than Ableton\'s full 7-color multi-assign system.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Browser navigation history + saved-search custom labels',
    description: 'Ableton has dedicated Back/Forward buttons traversing every prior search/label state, plus an "Add Label" button pinning a filtered result set as a durable sidebar entry (manual ch.4 pp.69,66). Not useful until search/filter chips (above) give the browser actual navigable state — sequence directly after those land. Once they do: a small `localStorage`-persisted list of `{name, query, tags}` rendered as extra sections; skip Ableton\'s icon-picker chrome entirely, a plain name is enough.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'User Library (cross-project preset save)',
    description: 'Ableton\'s User Library is a fixed-shape, portable, personal content folder distinct from any one project (`~/Music/Ableton/User Library`, manual ch.4 p.108). Today a dotbeat user-tweaked patch lives only inside the one project\'s `.beat` file — no "save this synth patch so tomorrow\'s different project can drag it in too." Build as a new top-level `presets/user/` tree next to the existing bundled `presets/factory.json`, plus a new `POST /library/save-preset` snapshotting a track\'s current live param state. Keeps D9\'s "presets are tooling, never grammar" property intact. Arguably underrated relative to its P2 label — revisit sooner if it starts blocking sound-design workflow.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'User Folders (arbitrary disk locations added to the browser)',
    description: 'Ableton scans/indexes arbitrary user-added folders alongside the fixed Packs/User Library rows, with graceful-degradation UI for moved/missing folders (manual ch.4 p.114). dotbeat\'s catalog is hardcoded to the daemon\'s bundled `presets/` tree — no way to point the browser at an arbitrary folder on disk. Directly blocks the sound-quality roadmap\'s Tier 2 content the moment it doesn\'t ship pre-bundled: a new `GET /library/folders` (list of user-added absolute paths, machine-local config) plus a recursive scan populating the same `LibraryCatalog` shape `fetchLibrary()` already returns. Skip the moved/missing-folder graceful-degradation UI for v1 — fail loud.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: '"Drag into empty space creates a track" for presets/kits (not just soundfonts)',
    description: 'Ableton: dropping content into empty space right of/below the track list spawns a new track of the inferred kind (manual ch.4 p.118). dotbeat has this only for soundfonts (`SoundfontRow`\'s `+` button) — not presets or kits. `addTrackOfKind` already exists (used by that same button); the only missing piece is a drop target reading `DragPayload.type` (`preset`/`kit-lane`, not just `soundfont`) to infer track kind before calling the matching install function. Cheap — this is wiring, not new capability.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/51-ableton-vs-dotbeat-browser.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Analysis-file cache (waveform peaks, detected tempo) keyed by sha256',
    description: 'Ableton\'s `.asd` sidecar caches waveform/stretch/tempo-detection data per sample, filename-keyed (manual ch.5 p.121). dotbeat has no equivalent cache — every waveform render/tempo estimate recomputes from scratch. Cache derived DSP data keyed by `sha256` (stronger than Ableton\'s filename key — survives a rename) as `media/<hash>.analysis.json`, computed once on first daemon read, consumed by the GUI\'s waveform renderer. Skip the "default clip settings" half of `.asd` — D9\'s frozen-default elision already covers that without a sidecar.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Packing a project (`beat pack`/`unpack`)',
    description: 'Ableton\'s Pack (`.alp`) is a lossless-compressed, non-destructive archive of a whole project folder for handoff/backup (manual ch.5 p.148). git already solves this — a thin `beat pack`/`beat unpack` wrapper around `git bundle create` (full history) or `git archive` (snapshot-only) plus `git lfs fetch` for LFS-tracked binaries, consistent with D10\'s "this is just git" precedent for pins. No bespoke archive format needed.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: '"Save as Template" discoverability (default-template config)',
    description: 'Ableton lets a user "Set Default Live Set" so `File → New` always opens with a chosen template (manual ch.5 p.135). dotbeat\'s "Save as Template" ships but has no default-template config — `beat init`/`POST /new-project` always start blank unless `--from`/`from` is explicitly passed. A small `defaultTemplate` field in a local (gitignored) CLI/daemon config, read when no `from` is supplied. Low value relative to most other rows here — sequence last.',
    core: 'na', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },

  // ── Macros ───────────────────────────────────────────────────────────────
  {
    area: 'Macros', feature: 'Macro tooling layer',
    description: 'A curated "front panel" of knobs mapped to real params, living outside the file (like presets) — turning a macro writes literal edits, never an in-file indirection. Phase 23 research stream RC scoped the concrete data shape (BeatMacro/MacroTarget), storage (presets/macros.json via the existing /library route), and GUI placement (a Macros row in SynthPanel.tsx) — see research/27. Two independent chapter comparisons (63, 64) each called this "the single biggest scoped-but-unbuilt gap" surfaced by their whole comparison against Ableton\'s Macro Controls (up to 16 mappable knobs, 8 visible by default, min/max/curve per mapping — manual ch.24 pp.474-475). Built Phase 26 Stream DD directly from research 27\'s design: `src/core/macro.ts` (`BeatMacro`/`MacroTarget`/`resolveMacro`/`applyMacro`, mirrors `src/core/preset.ts`), `presets/macros.json` (8-macro starter set: Filter Sweep/Grit/Space/Warmth/Motion/Width/Punch/Snap), `GET /library` gained a `macros` array + `POST /library/apply-macro`, `beat macro list/apply` CLI + `beat_macro_list`/`beat_macro_apply` MCP tools, and a Macros row in SynthPanel.tsx (client-side resolve, posts through the existing per-path-debounced /edit channel — no new daemon route needed for the interactive drag). Resolves to literal edits, no in-file indirection (D9) — closes the single largest capability gap the whole synth/drum sound-design comparison surfaced.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/27-macro-tooling-layer.md', plan: 'phase-26-plan.md',
  },
  {
    area: 'Macros', feature: 'Macro randomization + per-macro exclude flag',
    description: 'Ableton\'s Rand button randomizes every mapped macro at once, with volume-shaped macros excluded by default as a footgun-prevention convention (manual ch.24 p.476). Sequence strictly after the Macro tooling layer above ships. Add `excludeFromRandomize?: boolean` to `BeatMacro`, defaulted true for any macro whose sole/first target is a volume-shaped param; a "Rand" button in the Macros row iterates visible, non-excluded macros. Cheap, real v1.1 polish, not required for the initial macro build.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/64-ableton-vs-dotbeat-racks.md', plan: null,
  },

  // ── Undo / redo ──────────────────────────────────────────────────────────
  {
    area: 'Undo / redo (in-session)', feature: 'Multi-level in-session undo/redo',
    description: 'Distinct from checkpoint/history versioning. Stripped from the original BeatLab port and never rebuilt for 25 phases — Ctrl+Z did nothing anywhere in the GUI. Phase 26 Stream DB built research/28\'s design exactly as scoped: a SEPARATE, session-only, in-memory undo/redo stack of full BeatDocument snapshots in `src/daemon/daemon.ts` (not merged into the git-checkpoint system), living behind the one choke point every mutating route already shares (`writeIfChanged`) rather than instrumenting all 15+ routes individually. Gesture coalescing is real: a knob drag firing several debounced `POST /edit` calls for the same path within a 700ms window collapses into ONE undo step (verified live — a 4-tick drag produced exactly one undo entry, not four), while the bare `<track>.note`/`<track>.hit` ADD grammar is deliberately excluded from coalescing (each call mints a new entity, so two quick adds must stay two steps). `GET /undo-state` + a broadcast `undo-state` SSE event keep every connected client\'s Undo/Redo buttons (TransportBar, greyed out per research/28 §5.6\'s own recommendation — no History-panel-style flat list, by that same section\'s explicit reasoning) in sync without polling. An external file change (a hand-edit/CLI call landing on disk) clears both stacks per research/28 §3\'s named edge case, verified live. `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (+ `Ctrl/Cmd+Y`) wired globally in `App.tsx`, same guarded-global-listener shape as the existing Shift+Tab handler. No CLI/MCP verb — this is a GUI-session mechanism only, `beat undo` was never in scope (the durable equivalent is `beat restore`).',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: 'research/28-undo-redo-vs-checkpoint-history.md', plan: 'phase-26-plan.md',
  },

  // ── Project / folder management ──────────────────────────────────────────
  {
    area: 'Project / folder management', feature: 'beat init + "Open Folder" re-pointing',
    description: 'Initialize a new .beat project and re-point the desktop app at a different project folder.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-track-project-management.md',
  },
  {
    area: 'Project / folder management', feature: 'New-project-from-scratch, GUI-reachable',
    description: 'Create a brand new project without dropping to the CLI first: a "new project…" toolbar action (next to "open folder…") prompts for a destination and POSTs the daemon\'s new POST /new-project route, which wraps the same initDocument() `beat init` uses. Works from ANY running daemon, not just the Tauri folder-repoint flow — verifiable live in a plain browser.',
    core: 'na', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-22-stream-af.md',
  },
  {
    area: 'Project / folder management', feature: 'Save project as template',
    description: '"Save as Template" opens as a fresh unsaved copy, never mutating the original — a natural fit for dotbeat\'s git-native model as "copy this file/folder as a new project," arguably cleaner than a browser-storage version. POST /save-as-template copies the CURRENT on-disk project bytes to a new path; starting a new project from a saved template reuses POST /new-project with a `from` template path (a byte copy, read-only against the template). No new core/CLI surface needed — a .beat file is a plain text file, so "save as template" is already just `cp project.beat template.beat` from a shell or agent; the GUI route exists for discoverability, not because the CLI/agent couldn\'t already do this.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: 'phase-22-stream-af.md',
  },
  {
    area: 'Project / folder management', feature: 'Optional cloud-folder sync (BYO storage)',
    description: 'Sync a project folder to a drive the user already has (Nextcloud/Dropbox/GDrive via one storage-agnostic interface) for multi-machine convenience — explicitly not live collaboration; git still owns history/versioning. Not scoped or requested yet, noted as the right shape if/when it is.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/23-opendaw-collaboration-storage.md', plan: null,
  },
  {
    area: 'Project / folder management', feature: 'Lift a track/clip from another project (`beat import-track`)',
    description: 'Ableton\'s Merging Sets lets a user drag a whole Set from the browser onto a track/empty space to reconstruct all its tracks/clips/devices, or unfold a Set like a folder and drag out one track/clip/device chain/Group Track without opening it (manual ch.5 pp.131-134). dotbeat has no equivalent — `beat import-track <source.beat> <track-id> --into <dest.beat> [--as <new-id>]` is a well-defined text operation given both files share one grammar and stable slugs (D6), more precise than Ableton\'s drag-target ambiguity since there\'s no rendering/preview step to get wrong.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/52-ableton-vs-dotbeat-files-and-sets.md', plan: null,
  },

  // ── Desktop app / packaging ──────────────────────────────────────────────
  {
    area: 'Desktop app / packaging', feature: 'Tauri shell, compiled sidecar, bundled starter',
    description: 'Real desktop shell, force-quit-safe, local-machine distribution only (no notarization/signing, decisions.md D13).',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'decisions.md',
  },

  // ── Audio-region clip editing ─────────────────────────────────────────────
  {
    area: 'Audio-region clip editing', feature: 'Audio-region clip format',
    description: 'Media reference + in-point + out-point + gain + a warp enum + optional markers (v0.10). Clip-only (no live/non-clip audio content this stream); one clip = one region, all six fields on one bundled `audio` line (note/hit discipline, no elision). Phase 23 Stream BC closed the GUI gap: drag a kit one-shot from the content browser onto an audio track to create/replace a region (mints a clip and slots it into the current song section\'s scene, or fills an already-slotted clip in place), plus a static min/max-per-pixel waveform in the clip inspector so the in/out trim fields are visually legible. Also fixed a real bug the drag-drop flow surfaced: converting loop mode to song mode with an audio track present used to 500 (sceneFromLiveContent tried to snapshot a live-content clip an audio track structurally can\'t have) — audio tracks now correctly stay unmapped/silent until a real region is created.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-23-stream-bc.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Repitch-mode warping',
    description: 'A playbackRate-equivalent `rate` field, wired into ui/src/audio/engine.ts via Tone.Player.playbackRate; canonically forced to 1 when warp isn\'t \'repitch\'. Verified live: rendered spectral centroid shifts ~2x for a 1.5x rate (measured off real captured audio, not the stored param). The warp/rate controls themselves are full GUI fields (not the clip-block visual, which is the format row\'s documented gap).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Split-at-point',
    description: 'splitAudioClip: a pure edit primitive, no DSP — converts a timeline step position to source-media seconds (accounting for repitch rate), trims the first clip\'s out, mints a second clip with adjusted in, partitions gain-automation points by time. CLI `beat audio-split` / MCP beat_audio_split / a GUI split-at-playhead button (POST /audio-split).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Clip gain (static + automation lane)',
    description: 'Static gainDb field (default 0) plus a \'gain\' automation lane reusing the v0.9 BeatAutomationLane/BeatAutomationPoint machinery UNCHANGED (confirmed research 16 §3\'s prediction) — only a new AUDIO_AUTOMATABLE_PARAMS=[\'gain\'] set and a track-kind branch in checkAutomatableParam. Verified live: both static gain and a gain ramp measurably change rendered level.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Region-level fade in/out handles',
    description: 'Two draggable, region-relative 0..1 handles at region edges (linear, crossing = min of both, snap-to-grid) — a small format addition (two normalized fields per region), well-specified prior art. Ableton\'s concrete acceptance criteria (manual ch.6 pp.162-165): a Fade In Start/Fade Out End duration handle plus a Fade Curve shape handle, hard constraints (a fade can\'t cross a clip\'s own loop boundary; start/end fades on one clip can\'t overlap each other), and an auto-4ms-fade-on-edges default. Two normalized fields (`fadeIn`, `fadeOut`) on `BeatAudioRegion`; drag handles on `AudioClipInspector`\'s existing waveform canvas; engine-side linear gain ramp in the region player.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Tape-emulation knobs on audio-clip tracks',
    description: 'Four unipolar "tape character" fields (flutter/wow/noise/saturation) baked into the region player itself, not a separate effect — cheap, on-brand with SYNTH_FIELDS\' small evocative knobs, could share saturation-curve code with the Saturator FX.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/21-opendaw-devices-effects.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Warp markers + Complex-mode stretch',
    description: 'Marker-list format addition plus a real stretch-algorithm integration via signalsmith-stretch (MIT/WASM). Consider the 3-way TransientPlayMode vocabulary (Once/Repeat/Pingpong — research 22) for "what happens to a hit between two markers," smaller than Ableton\'s 5-way named-warp-mode system. Phase 23 research stream RA scoped the concrete grammar (`marker <id> <sourceTime> <timelineTime>`), WASM binding (official signalsmith-stretch npm package), and offline-pre-stretch engine architecture — see research/25. `WarpMode` already has a `\'complex\'` enum value but the engine branch treats it identically to `\'off\'` (`region.warp === \'repitch\' ? region.rate : 1`, engine.ts:3262) — confirmed zero grep matches for `addWarpMarker`/`detectTransients`/`autoWarp` anywhere in `src/`/`ui/src/`. Build in two slices as scoped: Slice 1 (format + primitives, P0 by build-order) is pure grammar/edit-primitive work, zero DSP, unblocks GUI immediately; Slice 2 (the actual stretch DSP, also P0) batch-renders via signalsmith-stretch into a cached buffer, gated behind `warp:\'complex\' && markers.length>0`, sequenced directly after Slice 1 since markers with no stretch consumer are inert.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/56-ableton-vs-dotbeat-audio-warping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Beats-mode transient slicing',
    description: 'Onset/transient detection plus the stretch library; sequence after warp markers + Complex-mode stretch (above) prove out. Phase 23 research stream RB recommends a dependency-free pure-TypeScript energy-based detector populating the same BeatAudioRegion.markers grammar RA scoped, with an MVP tier (markers + waveform overlay + split-at-transient) shippable independent of the stretch engine — see research/26. Ableton\'s Beats mode also carries its own Preserve (Transients vs. fixed grid division) and Transient Loop Mode sub-controls (manual ch.9 pp.234-235) governing what plays in a stretched gap.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/56-ableton-vs-dotbeat-audio-warping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Tempo/BPM estimation on import (×2/÷2 correction)',
    description: 'Ableton: an even-length-loop heuristic seeds two markers, shows an estimated BPM with ×2/÷2 correction buttons, plus explicit odd/uneven-length-loop recovery workflows (manual ch.9 pp.227-229). dotbeat has zero tempo-detection code today. New `detectTempo` core primitive (autocorrelation/comb-filter over the already-decoded buffer), CLI `beat detect-tempo` / MCP `beat_detect_tempo` — returns a *suggested* BPM, never silently overwrites `doc.bpm` (same "tool input, not grammar" posture as quantize\'s amount param). Upstream dependency for both import-time auto-warp settings and the "Warp From Here" bulk re-derivation, neither of which should be scoped before this lands.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/56-ableton-vs-dotbeat-audio-warping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Quantize Audio (snap transients to grid, Amount blend)',
    description: 'Ableton: snap the nearest transient to the grid with an Amount blend, a dedicated Quantize panel including triplets (manual ch.9 pp.233-234). The underlying blend mechanism is already shared with `quantizeNotes` (src/core/edit.ts:390-460) — near-zero net-new design risk. `quantizeWarpMarkers(doc, trackId, clipId, {amount})`, directly modeled on the already-shipped, already-tested `quantizeNotes` — identical validation, identical blend math. CLI `beat quantize-audio` / MCP `beat_quantize_audio`, direct sibling of `beat quantize`. Build immediately after warp markers ship (needs a marker list to quantize).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/56-ableton-vs-dotbeat-audio-warping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Interactive waveform editing (drag markers, drag-to-trim)',
    description: 'Ableton: drag a marker, Shift-drag to move the underlying audio under a fixed marker, double-click/Backspace to delete (manual ch.9 p.225). dotbeat\'s waveform render (ui/src/audio/waveform.ts) is entirely display-only today. This is what makes warp markers actually usable day-to-day — numeric-only fields are an accepted v1 gap, not a permanent one. Extend the waveform component + `AudioClipInspector` with pointer-event drag handlers writing through `setWarpMarker`/`setClipAudioRegion`, using a two-tier live-preview approach: a cheap `playbackRate`-scalar approximation during the drag (reusing the mechanism `repitch` mode already has), debounced to an authoritative render on release — avoids standing up a real-time worklet.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/56-ableton-vs-dotbeat-audio-warping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Segment-level splice into a composite (basic comping primitive)',
    description: 'Ableton\'s take-lane compositing (`Ctrl`/`Cmd`+Up/Down swap, Copy Selection to Main Lane) replaces PART of a clip (a bar range) with the corresponding span from a different take/clip — the single largest capability gap in the comping comparison, confirmed absent from `src/core/edit.ts`, `cli/beat.mjs`, and `src/mcp/server.ts` (manual ch.21 p.418). dotbeat already has the sibling-clips data model (`track.clips[]` + `BeatScene.slots`, "keep N candidates, pick one") but nothing that reads bars `[a,b)` from one clip into another. One new edit primitive sized like `splitAudioClip`, format-neutral (notes/hits/audio regions all use the same bar-range operation). CLI/MCP first per D14\'s sequencing — no GUI required to ship real value; the highest-leverage move in the comping comparison since every other row there depends on or defers behind it.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/62-ableton-vs-dotbeat-comping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Take lanes as a dedicated visual UI (candidate-clip lane stack)',
    description: 'Ableton shows N parallel horizontal candidate lanes stacked under a track, toggled with `Ctrl Alt U` (manual ch.21 pp.414-415). dotbeat has the data shape (sibling clips via `track.clips[]`) but zero visual representation of "these clips are candidates for the same slot." Don\'t build the literal lane-stack UI before the segment-splice primitive above exists — it\'s a rendering layer on top of that primitive, not a rendering layer on top of nothing. Once segment-splice ships and shows real usage, revisit as an arrangement-view addition (candidate clips as a collapsible sub-row, reusing existing clip-block rendering).',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/62-ableton-vs-dotbeat-comping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Per-take auto-randomized clip color',
    description: 'Ableton\'s Theme & Colors setting assigns a different color to each recorded take automatically (manual ch.21 p.417). Trivial, cosmetic, and only meaningful once multiple candidate clips are visually stacked — bundle into the take-lanes visual UI stream above rather than scoping standalone; reuses the existing track-color infrastructure tracks already have.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/62-ableton-vs-dotbeat-comping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Auto-crossfade at comp seams ("Create Fades on Clip Edges")',
    description: 'Ableton\'s `Ctrl Alt F` auto-fades a 4ms crossfade at a comp splice point (manual ch.21 p.418). Blocked on a real prerequisite that\'s independently already unstarted: region-level fade in/out handles (above). Don\'t scope comp-seam crossfading before that lands — once it does, auto-crossfade-at-splice-boundary is a small, natural extension of the same fade machinery.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/62-ableton-vs-dotbeat-comping.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Bounce / freeze a MIDI clip to audio',
    description: 'Render a MIDI clip, with its full effect chain, to a new audio clip in place — directly composable with the existing render engine once the audio-region clip format exists; sequence right after that lands.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Reverse audio clip',
    description: 'An in-place reverse toggle on an audio region — trivial once regions exist, same dependency as bounce/freeze.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Native audio recording',
    description: 'No capture path exists today; gated behind the confirmed ~30ms web-audio latency wall — explicitly Tauri/M4-native scope.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: 'm4-native-engine-design.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Multi-take comping, freeze/flatten/bounce',
    description: 'Needs the butler-thread disk-streaming architecture already scoped for M4.2 — a different problem from single-clip warping.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: 'm4-native-engine-design.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Content-slide-within-fixed-boundary waveform drag',
    description: '`Ctrl+Shift`/`Shift+Option`+drag on a clip\'s waveform display slides its contents within fixed clip edges, distinct from moving the clip itself (manual ch.6 p.162). dotbeat\'s `AudioClipInspector` only exposes `in`/`out` as plain numeric fields — no drag gesture on the waveform exists yet. A drag gesture on the waveform canvas that shifts `in`/`out` together (same window width, different offset into source media); sequence after basic drag-to-trim lands.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/53-ableton-vs-dotbeat-arrangement-view.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Sample details readout (name/rate/bitdepth/channels)',
    description: 'Ableton\'s Sample Editor header shows a details readout with an asterisk on disagreement across a multi-select (manual ch.8 p.215). No such readout exists in dotbeat\'s audio-clip editing surface. A small header addition to the audio-clip properties panel, read straight off the decoded `AudioBuffer` — no new format field needed.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Non-destructive crop to a new, shorter physical file',
    description: 'Ableton\'s "crop to start/end"/"crop to time selection" produces a genuinely new, shorter sample file (manual ch.8 p.216) — distinct from dotbeat\'s existing `splitAudioClip`, which creates two clips referencing the SAME source media. Needs a real audio-trim-and-re-encode step server-side (daemon route), writing a new file under `media/`. Sequence behind warp-mode work since both touch the same audio-region code paths.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Replace-the-sample gesture (swap media, keep clip settings)',
    description: 'Ableton: drag a new sample onto an open Clip View; pitch/gain retained, Warp Markers retained only if the new sample matches length (manual ch.8 p.216). No equivalent "swap the underlying media, keep the clip\'s other settings" affordance exists in dotbeat\'s audio clip flow today. A drag target on the open clip\'s waveform view that swaps `BeatAudioRegion`\'s media reference while keeping `gainDb`/`rate`, clearing `markers` unless the new file\'s duration matches exactly. Natural companion to the non-destructive-crop row above.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Duplicate Loop (doubles a clip\'s loop length + content)',
    description: 'Ableton\'s Duplicate Loop doubles the loop\'s length AND content, sliding trailing MIDI notes to preserve their position relative to the new end (manual ch.8 p.214). No dotbeat equivalent — `timeScale` (×2 in `PitchTimePanel`) rescales note positions but does not touch `clip.loop.end` itself. New `src/core/edit.ts` primitive: double `clip.loop.end - clip.loop.start`, duplicate the bar-range worth of notes/hits, shift any trailing content past the old end. Natural pairing with the P0 loop-resize UX (Note editing area).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/55-ableton-vs-dotbeat-clip-view.md', plan: null,
  },

  // ── Agent onboarding ──────────────────────────────────────────────────────
  {
    area: 'Agent onboarding', feature: 'beat mcp-init + Claude Code skill',
    description: 'Live-verified onboarding skill that sets an agent up to drive dotbeat via MCP.',
    core: 'na', cli: 'done', gui: 'na', status: 'done',
    research: null, plan: 'phase-17-cc-skill.md',
  },
]

# Phase 24 Stream CF — clip view: show what notes are playing

`docs/phase-24-plan.md`'s smallest, most contained stream. The owner's complaint: `NoteView.tsx`'s
piano roll shows notes as ROW POSITIONS on a keyboard-strip axis, but reading actual pitches back off
it means eyeballing key labels one row at a time — there's no at-a-glance text readout of what notes
are actually present.

## What already existed

A note-name formatter was already in `ui/src/components/NoteView.tsx`, added by Phase 19 Stream U for
the piano-key strip's own labels:

```ts
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const pc = (pitch: number) => ((pitch % 12) + 12) % 12
/** Scientific pitch notation: MIDI 60 = C4 (middle C), 0 = C-1. Used for the key labels. */
const pitchName = (pitch: number) => `${NOTE_NAMES[pc(pitch)]}${Math.floor(pitch / 12) - 1}`
```

This stream reuses it as-is — no second pitch-to-name mapping was written. (`ui/src/audio/engine.ts`
was also checked; it only has pitch<->frequency helpers, no name formatter — irrelevant here.)

## What was built

A new `NoteNameReadout` component, placed directly next to the existing per-note inspector panel
(Phase 22 Stream AD's `NoteInspector`, chance/cent/ratchet fields) and following the same visual
conventions (`.note-inspector`'s dark panel/border/11px-muted-text styling, a `-title` + scoped-field
layout mirroring `PitchTimePanel`'s own `scopeLabel` idiom for "N selected" vs. "whole track").

Rendered for every melodic (non-drum) track, always — not gated on a selection existing, unlike
`NoteInspector` (which only shows for exactly one selected note, since chance/cent/ratchet are
single-note fields). The note-name readout is useful in both states, so:

- **Nothing selected**: shows every DISTINCT pitch present anywhere in the visible clip, sorted
  ascending, comma-separated — e.g. `notes (whole clip) G4, A4, C5, D5, E5`.
- **One or more notes selected**: narrows to just the selected notes' distinct pitches, same sort/
  format — e.g. `notes (2 selected) C5, E5`. Sorted by pitch value, not click/selection order.

Drum tracks are excluded: drum lanes are named, not pitched (`DrumLanePanel` already covers those),
so there's nothing for a pitch-name readout to show there.

### Implementation

`ui/src/components/NoteView.tsx`:
- `NoteNameReadout({ track, noteIds })` — a small function component right before `NoteInspector`'s
  own definition. Scopes to `noteIds` (the `sel` array) when non-empty, else the whole track's notes;
  dedupes by pitch via a `Set`, sorts ascending, maps through the existing `pitchName`.
- Rendered in the JSX body as `{!isDrums && <NoteNameReadout track={track} noteIds={sel} />}`,
  immediately after `PitchTimePanel` and immediately before `NoteInspector` — the same position/order
  every other Phase 22/23 note-selection-scoped panel in this file already occupies.
- `data-testid="note-name-readout"` on the container, and `data-note-names` (comma-joined names) on
  the inner span, for stable test/tool hooks (mirrors this file's existing `data-note-id`/
  `data-row-value` convention).

`ui/src/styles.css`:
- `.note-name-readout` / `.note-name-readout-names` — new rules directly above `.pitch-time-panel`,
  copying `.note-inspector`'s panel chrome (dark background, 1px `--line` border, 11px muted text) so
  it reads as part of the same family of inspector strips rather than a new visual language. The names
  themselves render in a monospace font for scannability.

No format/daemon changes — this is pure client-side derived display, computed from data the GUI
already has loaded (`track.notes`, the current `editNoteIds` selection).

## Verification

`ui/verify-phase24-stream-cf.mjs` — Playwright-driven against a real `beat daemon` and the real built
frontend (same harness shape as `ui/verify-phase19-piano-keys.mjs`), using `examples/night-shift.beat`'s
`lead` track (notes at pitches 76, 72, 74, 69, 67, 69, 76 → distinct pitches {67, 69, 72, 74, 76} =
G4, A4, C5, D5, E5):

- **W1**: nothing selected → readout text is exactly `"G4, A4, C5, D5, E5"`, scope text contains
  "whole clip", and the `data-note-names` attribute matches.
- **W2**: click note `u100033` (pitch 76) → readout narrows to `"E5"`, scope contains "1 selected".
- **W3**: shift-click note `u100034` (pitch 72) too → readout shows `"C5, E5"` (sorted by pitch, not
  click order — E5 was clicked first), scope contains "2 selected".
- **W4**: a short drag over empty grid space (the existing marquee-over-nothing gesture, which clears
  selection without adding a note — a plain tap would have added one, since that's this editor's
  existing click-to-add affordance) clears the selection → readout reverts to the W1 whole-clip list,
  and the underlying note count is asserted unchanged (7) to confirm nothing was accidentally added.

Run: `node ui/verify-phase24-stream-cf.mjs` (builds both `dist/` and `ui/dist/` first, then drives a
headless Chrome against a `vite preview` server bridged to a real daemon on a scratch copy of the
fixture — nothing in `examples/` is mutated). All four checks pass. Screenshot artifact:
`ui/verify-p24-cf-note-names.png`.

## Files touched

- `ui/src/components/NoteView.tsx` — `NoteNameReadout` component + its render-site.
- `ui/src/styles.css` — `.note-name-readout` / `.note-name-readout-names` rules.
- `ui/verify-phase24-stream-cf.mjs` — new live verification script (this stream's deliverable #2).
- `ui/verify-p24-cf-note-names.png` — verification screenshot artifact.

// Phase 28 Stream FC (docs/phase-28-plan.md, research/79 §3.10/§4 P1 item 7). research/79 grepped
// every keydown/onKeyDown/e.key handler in the app and found the real shortcut surface is not
// invisible, but scattered across THREE different disclosure mechanisms with no single place to
// see them all: a persistent on-canvas label (App.tsx's `.bottom-pane-hint`, Shift+Tab only), a
// hover-only native tooltip (TransportBar's Undo/Redo `title` attrs), and a dense inline run-on
// sentence (NoteView's `.toolbar-tip`). Knob.tsx's Enter/Escape has none of the three. This panel
// doesn't replace any of those (they're each still useful in their own spot) — it's the one
// canonical reference a new user can open to see the app's ENTIRE real shortcut surface at once,
// grouped by the view it applies to. Every row here documents a shortcut that actually exists in
// the shipped keydown handlers as of this phase — nothing invented. Sources, cross-checked line by
// line against the live handlers:
//   - App.tsx:181-192 (Shift+Tab, guarded against INPUT/SELECT/TEXTAREA/contentEditable focus)
//   - App.tsx:201-218 (Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, same focus guard)
//   - NoteView.tsx:650-746 (select-all, copy/paste, delete, arrow nudge, shift+arrow resize/octave)
//   - Knob.tsx:96-107 (Enter commits the typed-value field, Escape reverts without committing)
//
// A static list, not a live-generated one — there's no central shortcut registry in the app to
// generate it from (each handler is a plain `window.addEventListener('keydown', ...)` inside its
// own component), so keeping this list honest is a manual discipline: any future stream that adds
// or changes a keydown handler should update this file in the same diff, the same way NoteView's
// own `.toolbar-tip` sentence already has to be kept in sync with its handler by hand.

interface ShortcutRow {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    rows: [
      { keys: ['Shift', 'Tab'], description: 'toggle the bottom pane between Clip (note editor) and Device (sound)' },
      { keys: ['Ctrl/Cmd', 'Z'], description: 'undo (in-session only, separate from version history)' },
      { keys: ['Ctrl/Cmd', 'Shift', 'Z'], description: 'redo' },
      { keys: ['Ctrl/Cmd', 'Y'], description: 'redo (alternate)' },
    ],
  },
  {
    title: 'Piano Roll / Note Editing',
    rows: [
      { keys: ['Ctrl/Cmd', 'A'], description: 'select all notes/hits in the clip' },
      { keys: ['Ctrl/Cmd', 'C'], description: 'copy the selected notes (notes only, not drum hits)' },
      { keys: ['Ctrl/Cmd', 'V'], description: 'paste copied notes at the current playhead' },
      { keys: ['Delete'], description: 'delete the selected notes/hits' },
      { keys: ['Backspace'], description: 'delete the selected notes/hits' },
      { keys: ['←', '→'], description: 'nudge the selection one step earlier/later' },
      { keys: ['↑', '↓'], description: 'move the selection one row up/down (pitch or lane)' },
      { keys: ['Shift', '←/→'], description: "resize the selection's duration by one step" },
      { keys: ['Shift', '↑/↓'], description: 'move the selection an octave up/down (pitch axis only)' },
    ],
  },
  {
    title: 'Knobs',
    rows: [
      { keys: ['Enter'], description: 'commit a typed value in a knob’s click-to-type field' },
      { keys: ['Escape'], description: 'cancel a typed value without committing' },
    ],
  },
  {
    // Phase 30 Stream JD (docs/research/87): pilot 87 selected an arrangement clip block and tried
    // Delete and Cmd+D, both silent no-ops — reasonable to try, since the note editor one level down
    // supports both. Rather than leave that silence looking like a bug, say so explicitly: none of
    // the note editor's own row above applies up here at the arrangement level yet.
    title: 'Arrangement',
    rows: [
      {
        keys: ['—'],
        description: 'no arrangement-level shortcuts yet — selecting a clip block and pressing Delete or Cmd/Ctrl+D currently does nothing (works only inside the note/hit editor above)',
      },
    ],
  },
]

function Keycap({ label }: { label: string }) {
  return <span className="kbd">{label}</span>
}

function ShortcutRowView({ row }: { row: ShortcutRow }) {
  return (
    <div className="shortcut-row">
      <span className="shortcut-keys">
        {row.keys.map((k, i) => (
          <span key={i} className="shortcut-key-combo">
            {i > 0 && <span className="shortcut-plus">+</span>}
            <Keycap label={k} />
          </span>
        ))}
      </span>
      <span className="shortcut-desc">{row.description}</span>
    </div>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay-scrim" onClick={onClose} data-testid="shortcut-help-scrim">
      <div className="shortcut-help-panel" data-testid="shortcut-help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <span className="overlay-title">Keyboard shortcuts</span>
          <button className="topbar-btn" data-action="close-shortcuts" onClick={onClose} title="close keyboard shortcuts">
            Close
          </button>
        </div>
        <div className="shortcut-help-body">
          {GROUPS.map((group) => (
            <section key={group.title} className="shortcut-group">
              <h3 className="shortcut-group-title">{group.title}</h3>
              {group.rows.map((row, i) => (
                <ShortcutRowView key={i} row={row} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

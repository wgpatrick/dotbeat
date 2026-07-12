# Research 79 — UX round 2: cross-cutting design-system patterns after Phase 27

*2026-07-12. Round 2 of the UI/UX research pass, done after Phase 27 shipped real changes to
arrangement view, clip view, device view, browser, and drag-and-drop (`docs/phase-27-plan.md`,
streams EA-EJ). Research 70-74 (round 1) each went deep on one surface, screenshot-grounded
against the Ableton manual. This doc deliberately does **not** repeat any per-surface finding
those five already made — no more "the knob is drag-only," "the browser row has one icon," etc.
Scope here is strictly cross-cutting: does the app, now that five different Phase 27 streams have
each touched their own corner of it, read as **one consistent visual system**, or as five
separately-designed surfaces stitched together? The answer, grounded below, is closer to the
latter than the owner probably wants — not because any one surface looks bad, but because there is
no shared token layer underneath any of them, and every surface quietly invented its own answer to
questions (what gray is "dim text," what red is "destructive," what radius is "a card") that a
one-person, many-phases-deep codebase should only be answering once.*

## 1. Scope and method

Part 1 samples Ableton Live 12's Reference Manual across five chapters — ch03 (Live Concepts —
general chrome), ch04 (Browser), ch06 (Arrangement View), ch08 (Clip View), ch23 (Device View) —
specifically for the conventions that hold *across* those chapters: type scale, color-system
discipline, icon style, spacing rhythm, shortcut discoverability. Part 2 is a full read of
`ui/src/styles.css` (3,380 lines) plus a grep-level audit of every hex color, `border-radius`,
`font-size`, `letter-spacing`, and `font-family` declaration in the file, cross-referenced against
five fresh Playwright screenshots of the real running app (arrangement, clip/note view, device
view, mixer, browser) on a disposable copy of `examples/night-shift.beat` — never
`examples/night-shift-song.beat`, the owner's own live project.

## 2. Ableton's design-system conventions, screenshot-grounded

### 2.1 Color: two disjoint palettes, never mixed

Every sampled page draws the same line the manual itself implicitly documents: **track/clip
identity color** and **UI-chrome/state color** are two completely separate hue systems that never
overlap.

- **Track/clip color** (ch06 p.150, p.155, p.160; ch03 p.33, p.42) is a wide, low-saturation
  pastel set — mint, lavender, pale yellow, pale green, pink — one hue per track, used *only* to
  paint the clip body and the track's own accent strip. It carries zero state meaning: a muted
  track keeps its pastel color, just dimmed.
- **UI chrome** (panel backgrounds, borders, button faces) is neutral gray throughout, with **one**
  state color doing almost all of the signaling work: amber/orange. The Arrangement Record button
  (ch03 p.42) is a filled dark-orange/red circle; the "Auto" toggle and armed-track fields (ch03
  p.33, ch23 p.432) highlight amber-yellow; the loop brace (ch06 p.160) is a solid black outline,
  not colored at all. Red is reserved narrowly for record-arm state; green/teal appears only for
  the Session-view play-triangle and arm-strip (ch03 p.40), not reused elsewhere as a generic
  "success" color the way a dashboard might.
- Verdict: Ableton's manual shows **one accent hue doing double duty as both "this is active/armed"
  and "this is the thing to click here,"** with track color kept strictly decorative/identity-only.
  This is a two-tier system: identity (many hues, no meaning) and state (basically one hue, amber,
  used consistently).

### 2.2 Typography: value readouts vs. labels, one clear hierarchy

Across ch23's device screenshots (p.428, p.432, p.437) every parameter follows the same shape: a
small-caps or sentence-case **label** below or beside a boxed, tabular-digit **value readout**
(`"1.01 kHz"`, `"-4.0"`, `"265 ms"`, `"0.0 dB"`) in a slightly different, flatter typeface/box than
the label. Section headers (`"23.1 Device View"`, `"6.1 Layout"`) are the manual's own large
serif-adjacent display font — not part of the in-app UI at all, a documentation convention only.
Within the app screenshots themselves, there are exactly two type roles that repeat everywhere
sampled: a small uppercase/tracked **group label** (e.g. "MACROS" isn't literally shown, but
"Sidechain", "LFO", filter-mode labels in ch23 p.437 follow this) and a **boxed numeric value**
with tabular figures. No third or fourth heading tier appears inside the device/browser chrome
itself — the manual's own prose headers are excluded from this because they're not rendered UI.

### 2.3 Iconography: flat, single-weight, small, and sparse

Every control across ch03/ch04/ch06/ch08/ch23 is a simple flat glyph at one weight — a filled
triangle for play, a filled square for stop, a filled circle for record-arm, a small down-caret for
every dropdown (ch04 p.60's Type/Sounds/Character carets), a magnifying-adjacent search icon. There
is no mixed outline/fill iconography anywhere sampled — everything is filled, single-color, and
tiny (well under 16px in the source screenshots). Rows in the Browser (ch04 p.60, p.65) use small
folder/file-type glyphs to distinguish content type, consistently sized and consistently to the
left of the name — the exact row anatomy research/73 already covered for dotbeat's browser, not
repeated here.

### 2.4 Spacing/padding rhythm

Not independently measurable from page-image screenshots at this resolution beyond a qualitative
observation: chrome is dense (the Control Bar, ch03 p.33, packs nine labeled sections into one
~24px-tall strip) but every row within a panel keeps consistent internal padding — Browser rows
(ch04 p.65), Clip View property rows (ch08 p.190), and mixer-strip-style columns (ch23 p.432) all
read as the same "text hugs a ~4-8px inset" rhythm. This is consistent with dotbeat's own
tightly-packed rows (below) — not a gap worth chasing.

### 2.5 Keyboard-shortcut discoverability: documentation-only, via a consistent keycap glyph

This is the one area where Ableton's own convention is unambiguous and worth naming directly: every
shortcut mentioned in the sampled manual text (ch04 p.36 — `Ctrl Alt 5` / `Cmd Option 5` for
Show/Hide Browser; ch08 p.185 — `Ctrl Alt 3` / `Cmd Option 3` for Clip View toggle, `F12` / `Shift
Tab` for moving between windows; ch06 p.160 — the loop-brace arrow-key/modifier table) is rendered
as a **rounded-rectangle keycap badge**, one badge per key, chained with "+"-adjacent spacing, in
the manual's own body text. This is a real, consistent, in-*documentation* affordance — but nothing
in the sampled pages shows it living inside the running application itself (no menu-bar screenshot
with shortcuts right-aligned next to each item was among the sampled images; Live's OS menu bar
chrome isn't part of a page-image capture). The honest characterization: Ableton's manual has a
disciplined, reusable keycap-glyph pattern for teaching shortcuts, applied every time one is
mentioned — dotbeat has no equivalent glyph or reference surface anywhere (§3.5 below).

## 3. dotbeat's current design system, grounded in styles.css + fresh screenshots

Screenshots captured this pass (`/tmp/dotbeat-ux2-overall/0{1-5}-*.png`, built frontend + real
daemon on a disposable `.beat` copy): arrangement view with the bottom pane open on Clip, the same
track's Device tab, the Mixer overlay, and the Browser rail open over the arrangement. All five
share the same dark neutral chrome (`--bg #16171b` / `--panel #1e2026` / `--panel-2 #23262e`) and
the same amber accent, so at a glance the app does read as one dark theme, not five different
themes. The inconsistency is one level down: the *specific* grays, reds, radii, and label
treatments each Phase 27 (and earlier) stream reached for, independently, rather than reusing one
answer already sitting in `:root`.

### 3.1 The token layer is thin, and several "tokens" referenced in the CSS don't exist

`:root` (styles.css:1-12) defines exactly nine custom properties: `--bg`, `--panel`, `--panel-2`,
`--line`, `--text`, `--text-dim`, `--accent`, `--lane-w`, `--note-step-w`. No `--radius-*`, no
`--font-mono`, no semantic state colors (danger/success/warning). That's a legitimate minimal
starting point — the problem is that later code assumes a richer token set exists and references
custom properties that were **never added to `:root`**:

- `var(--muted, #9aa0ab)` — used 4 times (styles.css:1204, 1241, 1265, 1272, all Phase 27 Stream
  EG's note-inspector/note-name-readout/pitch-time-panel additions). `--muted` is never defined
  anywhere in the file, so every one of these always resolves to the hardcoded fallback
  `#9aa0ab` — a **fourth** distinct "dim text" gray, alongside the real `--text-dim` (`#8a8f9a`)
  that's used everywhere else in the app.
- `var(--danger, #e06c75)` — used 3 times (styles.css:3150, 3176, 3308: `.preset-picker-error`,
  `.macro-row-error`, `.lane-row-error`). `--danger` is likewise never defined; this is a phantom
  token that always falls back to `#e06c75`, a color that appears nowhere else in the file except
  one direct hardcode (`.arr-chip-btn.del:hover`, styles.css:2724-2725) and one inline style
  bypassing CSS entirely (`InstrumentPanel.tsx:230`, `style={{ color: '#e06c75' }}`) — the same
  color independently reinvented three different ways (CSS fallback, CSS literal, inline style).
- `var(--text, #e6e8ec)` — used ~7 times (e.g. styles.css:1208, 1244, 1269) as a fallback for the
  *real* `--text` (`#d8dbe2`). Since `--text` **is** defined, these fallbacks are dead code — but
  the embedded value (`#e6e8ec`) is a visibly different near-white than the actual `--text`
  (`#d8dbe2`), so anyone reading this CSS to understand "what color is body text" gets a wrong
  answer from roughly half the call sites.
- `var(--panel-2, #232630)` — used once (styles.css:1294, `.pitch-time-panel button`). The real
  `--panel-2` is `#23262e`; the embedded fallback is `#232630` — different in the last byte, a
  literal one-character drift from a copy/paste, again harmless only because the real variable
  always wins at runtime.

Net: four of the color decisions in this file are being made by dead or phantom fallback values
that don't match the file's own real tokens — not a cosmetic nit, a sign the token layer isn't
being consulted when new panels get added, just copied from whichever neighboring block looked
closest.

### 3.2 Near-black backgrounds: five different values for what should be one

`--bg` is `#16171b`. Independently of it, the file also uses:

- `#14151a` — 8 occurrences (`.noteview-grid`, `.noteview-vel-lane`, `.noteview-chance-lane`,
  `.note-inspector`, `.note-name-readout`, `.pitch-time-panel`, etc.) — the piano-roll/bottom-pane
  "recessed surface" color.
- `#1a1a1a` — 6 occurrences, all "text-on-accent" (`.play-btn` text, `.arr-resize-label`
  background text context, etc.) — close to `--bg` but not it.
- `#0f1014` — 2 occurrences (`.note-inspector-field input`, `.pitch-time-field input` backgrounds).
- `#1b1d23` — 1 occurrence (`.step.grp-b`, step-sequencer alternating-column shading).

None of these four literals is `--bg`, and none is reused as its own variable — every surface that
wanted "darker than panel, recessed" picked its own nearby-but-different hex.

### 3.3 The "destructive/error" red is eight different colors

Grepped directly (`grep -oE '#[0-9a-fA-F]{3,6}' styles.css | sort | uniq -c`): the file uses
**eight** distinct reds for what is functionally 2-3 semantic roles (destructive-hover/mute-active,
validation/parse-error text, recording/stop state, over-0dB peak indicator):

| hex | role | occurrences |
|---|---|---|
| `#c0503c` | destructive hover / mute-active (`.arr-track-del:hover`, `.arr-strip-btn.mute.on`, `.arr-group-ungroup:hover`, `.arr-auto-remove:hover`, `.mixer-btn.mute.on`) | 5 |
| `#e0564c` | stop/active-recording state (`.play-btn.stop`, `.clip-audition-btn.active`, `.note-del-btn`) | 3 |
| `#e8a0a0` | pastel error/undo text (`.parse-error`, `.vary-error`, `.vary-btn.undo`) | 3 |
| `#e06c75` / `var(--danger, #e06c75)` | the phantom-token family above + `.arr-chip-btn.del:hover` | 4 |
| `#e05a5a` | `.export-btn.error` | 1 |
| `#ff3b30` | `.mixer-meter-clip.on` (peak LED) | 1 |
| `#e08a6c` | `.history-error` text | 1 |
| `#e0857a` | `.library-status.error` | 1 |

`#c0503c` (used 5x) is closest to a real "destructive" token already; the other seven are one-off
reinventions, several of them (`#e0564c`/`#e05a5a`/`#e06c75`/`#e08a6c`/`#e0857a`) close enough in
hue/lightness that they'd be visually indistinguishable side by side, yet are five different
literal values in the source.

### 3.4 The "positive/success" green is four different colors

`#7bd88f` (`.conn.ok`), `#9bd08a` (`.vary-kept`), `#98c379` (`.kind-instrument` text +
`.note-name-readout` accent border, 2x), `#6ec97c` (`.export-btn.done`) — four distinct greens for
one semantic role (connected/kept/succeeded), never consolidated even though three of the four
(`#7bd88f`/`#9bd08a`/`#6ec97c`) are near-identical mid-saturation greens.

### 3.5 Border-radius: nine values in active use, one orphaned value

`grep -oE 'border-radius: [0-9]+px' styles.css | sort | uniq -c` turns up radii of 1, 2, 3, 4, 5,
6, 7, 8, and 10px. Most of this sorts into a real, if undocumented, three-tier scale: ~3-4px for
buttons/inputs (67 combined uses), 6px for mid-level cards (`.effect-chain`, `.param-group`,
`.lane-panel`, `.clip-props`, `.macro-row`, `.preset-picker`), 8px for the biggest structural
panels (`.stepseq`, `.synth-panel`, `.noteview`, `.instrument-note`, styles.css:539-547). Two
values don't fit that scale: **7px**, used exactly twice (`.pane-toggle`, styles.css:1512;
`.history-row`, styles.css:2542) — sitting orphaned between the 6px and 8px tiers with no third
tier anywhere else to justify it — and **10px**, used once (`.mixer-overlay`, styles.css:1587), one
step bigger than every other panel's 8px with no stated rationale (modals elsewhere, like
`.history-drawer`, don't get the same bump).

### 3.6 Letter-spacing: eight values, mixing px and em, for one visual convention

Every uppercase "section/group label" in the app (`MACROS`, `EFFECT CHAIN`, `PRESET`, `BROWSER`,
track-kind badges, transport-field labels) uses the same visual idea — small caps, tracked out —
but the actual `letter-spacing` values are: `0.02em`, `0.03em`, `0.04em` (×3), `0.05em`, `0.3px`,
`0.5px` (×4), `1px` (×3) (styles.css:78, 148, 297, 335, 681, 712, 771, 2163, 2196, 2353, 2660,
2826, 2891, 3120, 3172). Mixing `em`-based and `px`-based tracking for the identical visual role
across ~15 call sites means the actual rendered tightness drifts depending on which font-size that
particular label happens to sit at, not by design.

### 3.7 Four different conventions for "this is a panel's title," no shared class

There is no `.section-heading` or equivalent; each surface invented its own combination of
size/weight/case for what is semantically the same role:

1. **`.editor-title`** (arrangement view's own header, `App.tsx`/`ArrangementView.tsx:2313`,
   rendered as the literal lowercase string `"arrangement"`) — 14px / weight 700 / no
   text-transform.
2. **`.library-rail-title`** (the Browser rail, rendered `BROWSER` via CSS `text-transform:
   uppercase` on `styles.css:2822-2827`) — 12px / weight 700 / uppercase / 0.04em tracking.
3. **`.overlay-title`** (Mixer + History modals, `App.tsx:294` `"Mixer — all channel strips"`,
   `App.tsx:308` `"Version history"` — Title Case typed directly into the JSX, no CSS transform) —
   inherits body's 13px / weight 600 / Title Case.
4. **`.effect-chain-title` / `.macro-row-label` / `.param-group-title`** (device-view sub-panel
   headers) — 10px / weight 700 / uppercase / 0.5-1px tracking.

Four different size/weight/case combinations for one job, verified directly against the five fresh
screenshots this pass took (`02-clip-noteview.png`, `03-device-view.png`, `04-mixer.png`,
`05-browser.png` each show a different one of these four conventions in the same viewport).

### 3.8 font-family: two monospace stacks for one role

`ui-monospace, SFMono-Regular, Menlo, monospace` (styles.css:218 `.vary-label`, :2592
`.history-ref`) vs. the shorter `ui-monospace, monospace` (styles.css:1245
`.note-name-readout-names`, :1323 `.pitch-time-amount-readout`) — both used for the same
"tabular/technical data" role, never unified into one `--font-mono` token.

### 3.9 What's genuinely NOT a problem

Worth naming so the P0/P1 list below doesn't read as "rewrite everything": the five screenshots
this pass took do **cohere** at the macro level — one dark background, one amber accent used
consistently for "active/selected/on" across arrangement, device, and mixer (`.arr-auto-toggle.on`,
`.mixer-btn.solo.on`, `.pane-tab.active`, `.play-btn` all share `var(--accent)`), and Phase 27
Stream EB's shared `.dragging`/`.drop-target-hover` rules (styles.css:14-41) are a real, working
example of exactly the kind of consolidation the rest of this doc is asking for — proof the pattern
works when it's applied. The gap is that EB's own discipline ("one canonical answer... reused by
every drag surface," styles.css:14-18) was never generalized to color/radius/type, and each
subsequent stream's own doc comment (`.note-inspector`'s "same small hue palette... rather than
inventing new colors," styles.css:1190-1192) shows the *intent* was there per-stream, just never
elevated to a file-wide rule enforced once.

### 3.10 Keyboard-shortcut discoverability: a real gap, but not a total one

Grepping every `keydown`/`onKeyDown`/`e.key ===` across `ui/src/components/` and `App.tsx` finds
the app's full shortcut surface:

- **`App.tsx`**: `Shift+Tab` (toggle Clip/Device bottom pane, `App.tsx:178-190`); `Ctrl/Cmd+Z`
  (undo) and `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` (redo, `App.tsx:196-`).
- **`NoteView.tsx:664-744`**: `Cmd/Ctrl+A` (select all notes), `Cmd/Ctrl+C`/`Cmd/Ctrl+V`
  (copy/paste at playhead), `Delete`/`Backspace` (delete selection), arrow keys (nudge selected
  notes by step/row), `Shift`+arrow (resize duration / octave jump).
- **`Knob.tsx:98-101`**: `Enter` (commit typed value), `Escape` (cancel) — inside the Phase 27
  Stream EI click-to-type field.

There is **no dedicated shortcut reference/cheat-sheet panel anywhere in the app** — no help menu,
no `?`-key overlay, nothing resembling Ableton's keycap-glyph convention (§2.5). But it's not a
uniform zero, and the P0/P1 list below should credit what's already there rather than propose
duplicating it:

- The `Shift+Tab` toggle is the one shortcut with a persistent, always-visible in-app label:
  `<span className="bottom-pane-hint">Shift+Tab toggles</span>` (`App.tsx:93`), visible in
  `02-clip-noteview.png` right next to the Clip/Device tabs it controls.
- Undo/Redo *do* surface their shortcut, just as a hover-only native tooltip:
  `title="Undo (Ctrl/Cmd+Z) — in-session only..."` / `title="Redo (Ctrl/Cmd+Shift+Z)..."`
  (`TransportBar.tsx:56,65`) — discoverable only by hovering, gone the instant the mouse moves on.
- NoteView's entire shortcut set (select-all/copy/paste/delete/nudge/resize) **is** written out in
  plain text, permanently visible, in the `.toolbar-tip` row directly under the clip title bar
  (`NoteView.tsx:910`, visible verbatim in `02-clip-noteview.png`: *"...arrows nudge ·
  shift+←/→ resize · delete removes · double-click to delete...cmd/ctrl+c / cmd/ctrl+v to
  copy/paste at the playhead..."*) — this is the single best-discoverable shortcut surface in the
  app, just scoped to one view and written as one dense run-on sentence rather than a scannable
  list.

So the real gap isn't "shortcuts are invisible everywhere" — it's that the app has landed on
**three different disclosure mechanisms** (a persistent label, a hover tooltip, a dense inline
sentence) for three different shortcut sets, with no single place a new user could go to see all of
them at once, and Knob.tsx's Enter/Escape has none of the three.

## 4. Prioritized changes

### P0 — the token pass. Small, mechanical, fixes the drift that's already live

1. **Add the missing semantic tokens to `:root`** and repoint every phantom/dead fallback at them:
   `--danger: #c0503c` (promoting the color already used 5x as the de facto destructive color,
   folding in `#e06c75`/`#e05a5a`/`#e08a6c`/`#e0857a`/`#e8a0a0`'s roles), `--muted: #8a8f9a`
   (=`--text-dim`, eliminating the phantom `--muted` fallback entirely — `.note-inspector` etc.
   don't need a *fourth* gray, they need to reuse the second one that already exists), `--good:
   #7bd88f` (folding in `#9bd08a`/`#98c379`/`#6ec97c`). Fix `InstrumentPanel.tsx:230`'s inline
   `style={{ color: '#e06c75' }}` to use the new `--danger` class instead. This single pass touches
   ~25 call sites and removes every dead/phantom fallback identified in §3.1/3.3/3.4.
2. **Fold the four near-black literals into `--bg` or one new `--surface-recessed` token**
   (§3.2) — `#14151a` is used 8x and is the real "recessed grid surface" color; give it a name and
   repoint `#0f1014`/`#1b1d23`/`#1a1a1a`'s distinct *roles* (input bg vs. text-on-accent vs.
   step-shading) at either that token or a second small one, rather than three more one-off hexes.
3. **Collapse border-radius to a real three-tier scale** (§3.5): `--radius-sm: 4px` (buttons/
   inputs), `--radius-md: 6px` (cards), `--radius-lg: 8px` (top-level panels), and migrate the two
   orphaned 7px uses and the one 10px use onto the nearest tier — `.mixer-overlay` down to 8px
   unless there's a real reason a modal should read as "bigger" than every other panel (if so, make
   that a fourth named tier, not a silent one-off).

### P1 — the label/typography pass, and a real shortcut reference

4. **One `--label-tracking` token** (pick `0.05em`, §3.6) reused by every uppercase group-label
   class, replacing the eight mixed em/px values.
5. **A shared `.section-heading` (or two: `.panel-heading` for the 8px-tier panels,
   `.subpanel-heading` for the 6px-tier cards) class**, consolidating the four independently-
   invented title conventions in §3.7 — at minimum, standardize the case convention (uppercase via
   CSS `text-transform`, not hand-typed Title Case in JSX, so a future rename can't silently drift
   the casing again the way `.overlay-title`'s hand-typed strings already have).
6. **One `--font-mono` token** (§3.8) replacing the two monospace stacks.
7. **A real, lightweight keyboard-shortcut reference** — the gap identified in §3.10 is genuine:
   three different disclosure mechanisms (persistent label / hover tooltip / inline sentence) and
   no single place to see them all. Lowest-effort fix that matches the app's own existing idiom
   (NoteView's `.toolbar-tip` sentence) rather than inventing a new overlay system: a small `?`
   icon or `topbar-btn` (matching Browser/Mixer/History's own existing pattern, `App.tsx:239-260`)
   that opens a simple static list — Shift+Tab, Undo/Redo, and the NoteView editing set, grouped by
   the view they apply to. Doesn't need Ableton's keycap-glyph rendering (§2.5) to close the actual
   gap, just needs to exist somewhere other than "hover this specific button" or "read this one
   run-on sentence."

### P2 — lower-leverage, real but cosmetic

8. Reconcile the seven near-duplicate reds down to actually reusing the new `--danger` token
   file-wide, including the three literal `#e06c75` hardcodes that are copies of the phantom
   `--danger` fallback rather than the token itself (once P0 item 1 exists, these become trivial
   find/replace).
9. `.mixer-meter-clip.on`'s `#ff3b30` (an iOS-system-red, visually a different family from the
   app's own warm reds) is arguably a deliberate "this is a hardware peak LED, it should look
   alarming/different" choice — worth a one-line comment confirming that's intentional (like
   `.note-inspector`'s existing palette-reuse comments elsewhere in the file) rather than silently
   looking like an unreviewed tenth red.

## 5. Sources

Ableton Live 12 Reference Manual (owner-supplied PDF, `prior_art/`, gitignored) —
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/`: ch03 pp. 33, 36, 40, 42 (Live
Concepts / Control Bar / Browser toggle / Tracks); ch04 pp. 60, 65 (Browser layout, search/tag
filtering); ch06 pp. 150, 155, 160 (Arrangement View layout, scrub area, loop brace); ch08 pp. 185,
190 (Clip View shell, horizontal panel arrangement); ch23 pp. 428, 432, 437 (Device View, MIDI/
audio track arm buttons, Show Options / A-B device-state comparison) — 15 page images viewed this
pass, sampled across the five chapters specifically for cross-surface chrome/typography/color/icon
conventions, not per-control detail (already covered by research 70-73's own Ableton sampling).

dotbeat internal, this pass: `docs/phase-27-plan.md` (full read); `docs/research/70-74` (skimmed
for section headers only, to confirm no overlap); `ui/src/styles.css` (full read, all 3,380 lines,
plus `grep -oE` sweeps for every hex color / `border-radius` / `font-size` / `letter-spacing` /
`font-family` declaration in the file); `ui/src/App.tsx` (topbar buttons, overlay titles, Shift+Tab
and undo/redo key handlers); `ui/src/components/TransportBar.tsx` (undo/redo tooltip text);
`ui/src/components/NoteView.tsx` (keydown handler, `.toolbar-tip` shortcut sentence);
`ui/src/components/Knob.tsx` (Enter/Escape numeric-entry handler); `ui/src/components/
InstrumentPanel.tsx:230` (inline-style red hardcode); five fresh Playwright screenshots of the real
running app (`ui/src/dist` + root `dist/src/daemon/daemon.js`, driven against a real `beat daemon`
on a disposable copy of `examples/night-shift.beat` at `/tmp/dotbeat-ux2-overall/song.beat` — the
owner's own `examples/night-shift-song.beat` was never touched), at
`/tmp/dotbeat-ux2-overall/0{1-5}-*.png`, captured via `/tmp/dotbeat-ux2-overall/screenshot.mjs`
using the same `playwright-core` + `chromium.launch({channel: 'chrome'})` pattern every prior
`ui/verify-phase*.mjs` script already establishes.

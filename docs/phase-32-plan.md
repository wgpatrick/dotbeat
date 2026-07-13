# Phase 32 — the two usability findings that kept recurring

Unlike Phase 29-31, this isn't sourced from a fresh pilot batch — it's the two items sitting in the
"Known usability gaps (backlog)" / roadmap areas that Phase 31's own wrap-up flagged as deferred, and
that have now been independently rediscovered by enough separate pilots to be worth real feature
work instead of another deferral:

- **Right-click context menus** — no context menu exists anywhere for notes or arrangement clip
  blocks; found independently in `docs/research/81`, `87`, `92`, and `93` (four separate pilots).
- **Section/scene naming** — sections/scenes have no `name` field at all, only the auto-generated
  scene id (`s1`, `s2`, ...) forever; found in `docs/research/90`, with the same underlying gap
  implied by several other pilots' "how do I label this part of the song" friction.

Two streams, LA and LB — each is closer to a small feature than a bug fix, so give real design
judgment more room than a typical fix-phase item, but keep scope contained (a first real version,
not the maximal one).

## Streams

| Stream | Feature area | Primary files | Source research |
|---|---|---|---|
| LA | Right-click context menus for notes and arrangement clip blocks | `ui/src/components/NoteView.tsx`, `ui/src/components/ArrangementView.tsx` | 81, 87, 92, 93 |
| LB | Section/scene naming (format + parser + serializer + GUI) | `docs/format-spec.md`, `src/core/document.ts`, `src/core/parse.ts`, `src/core/serialize.ts`, `ui/src/components/ArrangementView.tsx` | 90 |

## LA — Right-click context menus

There's already one working precedent in the app: the automation lane's right-click breakpoint popup
(Phase 26 Stream DI) — a small, real menu-like popup with numeric entry and Linear/Hold/Curve
buttons. Notes and arrangement clip blocks have no equivalent; right-click on either currently does
nothing at all (confirmed exhaustively — no browser default menu either, so something is already
calling `preventDefault()` on the contextmenu event without doing anything with it, or the browser's
default is simply not suppressed and pilots just never got a native menu because nothing was
listening).

**Scope for a real v1** (keep it small and genuinely useful, not exhaustive — every item here should
map to something a user can already do some OTHER way today, so this is purely surfacing existing
capability contextually, not inventing new mutations):

- **Notes** (`NoteView.tsx`): right-click a note (or a multi-selection, if one exists) → a small
  menu with at least **Delete** and **Duplicate** (same operation Alt-drag-duplicate already
  performs, just without needing to drag). If it's a clean, small addition, consider **Quantize this
  note/selection to grid** too, since that's a common per-note action buried in the Pitch & Time
  toolbar otherwise. Don't try to surface the FULL Pitch & Time toolbar in a context menu — that
  toolbar's own UI is the right home for Transpose/Invert/Reverse/Fit to Scale/etc.; a context menu
  should cover the 2-3 things reached for constantly, not duplicate the whole panel.
- **Arrangement clip blocks** (`ArrangementView.tsx`): right-click a clip block → a menu with at
  least **Delete** (this currently has NO working path at all — Phase 30 Stream JD's own Shortcuts-
  panel documentation change confirms `Delete`/`Cmd+D` on a selected clip block are still documented
  no-ops; wire up a real "remove this track's slot from this section's scene" action here, since nothing
  else in the app does this today) and **Duplicate** (create an independent copy of this clip in a new
  scene — the real equivalent of what `+ capture scene` already does, just scoped to one clip instead
  of every track's current content, so this may be a genuinely new primitive in `src/core/edit.ts`/
  `src/daemon/daemon.ts` rather than a GUI-only wire-up; check whether an existing single-clip-copy
  primitive already exists before adding one). If Stream LB (section naming) lands first or in
  parallel, also add **Rename section** here as a third item — check before committing to this, don't
  block on LB if it's not ready.

Use whatever this app's existing conventions favor for a "menu" — there's no menu/popup COMPONENT
in the codebase yet outside the automation-lane popup's own bespoke implementation, so either adapt
that pattern into something reusable, or build a small new one. Keep it visually consistent with the
rest of the dark theme (check `ui/src/styles.css` for the automation popup's existing styling as a
starting point). Dismiss on Escape and on an outside click (a real UX requirement — don't repeat the
automation popup's own known dismiss-friction bug that Phase 29 Stream GE already had to fix
separately for that popup).

## LB — Section/scene naming

Current grammar, confirmed by reading the parser/serializer directly: a scene line is a strict
2-token `scene <id>` (`src/core/parse.ts:549`, `tokens.length !== 2` throws otherwise), and
`BeatScene` (`src/core/document.ts:650`) has only `id`/`slots`, no `name` field. No quoted-string
convention exists anywhere in the `.beat` grammar today (confirmed by grep) — every field is
whitespace-tokenized.

**Design decision to make explicitly, not assume:** does the name belong on the SCENE (the reusable
bundle of clips — matching how a pilot building "Part A" would think of it as one named musical idea,
even if it's reused across multiple song sections) or the SECTION (one placement of a scene into the
timeline — matching how the same scene reused twice might arguably want the SAME name both times
anyway, so this distinction may not matter much in practice)? Given research/90's own framing ("Part
A" / "Part B" were named per distinct musical content, and dotbeat's scene IS the unit of distinct
content, with sections being placements of it), naming the SCENE is very likely the more natural fit
architecturally — but confirm this reasoning holds by re-reading research/90 and research/93's "scene
vs section" comparison section before committing, since research/93 goes deep on exactly this
distinction and may surface a reason sections need their own independent name too (e.g. the SAME
scene reused as both an "Intro" and an "Outro" — arguably a real use case).

**Suggested grammar** (not mandatory — use judgment, but this fits the existing style with the least
new mechanism): a nested `name <token>` line inside the `scene` block, matching how other nested
per-scene/per-track fields already work (e.g. `lane <name> <backing>` inside a `track` block) —
`scene s1` / `  name partA`. Keep the name itself a slug-like token (letters/digits/_/-, matching
`SLUG_RE`'s existing convention for scene/track ids) rather than inventing a new quoted-string
parsing mechanism just for this one field — the GUI can render underscores as spaces for display if
that reads better, similar to how many tools separate an internal slug from a display label. Optional
field — omitting it is exactly today's behavior (scene id doubles as the only label), so this must be
a fully backward-compatible addition (every existing `.beat` file, including the format-version
gating this may need to bump, should keep parsing and round-tripping correctly with no `name` line
present).

**Required changes:**
1. `docs/format-spec.md` — document the new optional `name` field on the scene grammar.
2. `src/core/document.ts` — add `name?: string` to `BeatScene`.
3. `src/core/parse.ts` — parse an optional nested `name <token>` line within a scene block.
4. `src/core/serialize.ts` — serialize it back out when present, omit when absent (canonical form,
   matching the rest of the format's own "don't write default/absent fields" discipline).
5. A `src/core/edit.ts` primitive to set/clear a scene's name (check the existing pattern other
   simple field-setters use, e.g. how track rename or group rename work, and mirror it) — this also
   needs a CLI surface (`cli/beat.mjs`) and, if the project's convention is that every core capability
   gets one, an MCP tool too (check `src/mcp/server.ts` for the existing `beat_group_set`-style
   pattern used for renaming a group, and mirror it for scenes if that's the established norm — use
   judgment on whether a dedicated MCP tool is warranted for this one specific case, since Stream KA's
   CLI/MCP-parity precedent in this codebase suggests yes but this is a judgment call, not a strict
   requirement for this stream to ship).
6. GUI (`ArrangementView.tsx`): display the scene's name (falling back to its id when absent) on
   section chips instead of always showing the raw id; wire up rename via double-click on the
   section's name chip — matching the track-rename convention Phase 31 Stream KE just fixed (a single
   double-click should both select if needed and open the rename field, not require two separate
   double-clicks the way track rename used to).
7. **Test the full round-trip**: a document with a named scene should parse, serialize back to
   byte-identical output, and survive a rename edit correctly. Add real format tests (check
   `test/format-*.test.ts` for the existing convention) alongside whatever UI-level verify script
   this stream also writes.

## Merge order

LA and LB touch almost entirely disjoint files (LA: NoteView.tsx/ArrangementView.tsx interaction
code; LB: the core format layer plus a much smaller ArrangementView.tsx display/rename change) — low
conflict risk either order. If LA's "Rename section" context-menu item depends on LB's rename
mechanism existing, merge LB first; otherwise order doesn't matter much.

## Verification approach

Same discipline as every prior phase: independently re-run core typecheck, UI typecheck, full
`npm test`, each stream's own live-verify script, and the sibling stream's verify script as a
cross-stream regression check after each merge. For LB specifically, round-trip fidelity (parse →
serialize → byte-identical) is the correctness bar that matters most — verify it directly, not just
that the GUI shows the right label.

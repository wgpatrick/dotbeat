# Phase 28 — round 2 UI/UX: verify Phase 27's fixes, close what's newly gapped

*2026-07-12. Built off `docs/research/75-79` — round 2 of the same implementation-level UI/UX
research effort that produced Phase 27 (`docs/phase-27-plan.md`, streams EA-EJ). Where round 1
(research 70-74) found the app's biggest per-surface gaps against Ableton Live 12, this round does
two things on each of the same five surfaces (Arrangement, Clip View, Device View, Browser, plus a
new fifth pass — cross-cutting design-system patterns): (1) re-drives the real, post-Phase-27
running app live via Playwright to confirm each of Phase 27's fixes actually works, at the pixel/DOM
level, not by trusting the plan doc's own description; (2) looks for anything newly visible now that
those fixes are live — including, in three cases, real bugs Phase 27's own fixes introduced or left
half-finished, not just fresh polish opportunities. Phase 27 closed nearly the entire P0 backlog
round 1 raised — this round confirms that (research 75 found literally zero P0/P1 items on the
Arrangement surface) and finds a smaller, sharper set of new problems: a coarse-filter regression in
research 77's own re-verification of Phase 27's Bug-4 fix, a design-token layer that was never
actually wired up despite being referenced throughout `styles.css`, and one real visual collision
where two Phase 27 fixes (title bar + flat-opacity notes) landed correctly on their own but fuse
together when stacked. Scope stays GUI look/feel/interaction only, same as Phase 27 — no format
changes, no new core primitives beyond what a bug fix strictly requires.*

## Fix first — four genuine bugs (Streams FA, FD, FE)

Not aesthetic gaps — actual broken/wrong/dead behavior, each confirmed by driving the real running
app or reading the real shipped source, not inferred from a screenshot alone.

1. **`MacroRow`'s track-kind filter is coarser than the per-param legality check one line later in
   the same file, so instrument tracks render 1 of 8 factory macros instead of the ~3 they're
   actually entitled to.** `SynthPanel.tsx`'s `MacroRow` (`:462`) filters candidate macros with
   `m.kind === track.kind || m.kind === 'any'` — for an `instrument`-kind track only `space` (the one
   macro literally tagged `kind: 'any'`) survives. But `MacroKnob`'s own `onChange`, one function
   away, already calls a more precise test — `isParamLegalForKind` (`synthParams.ts:508-511`) —
   which checks whether the target param's `PARAM_GROUPS` group lists `'instrument'` in its `kinds`
   array. By that test `grit` (targets `distortionAmount`/`distortionMix`/`bitcrushBits`, both groups
   `instrument`-legal) and `warmth` (targets `eqHigh`/`eqLow`/`saturatorDrive`/`saturatorMix`, `eq3`
   also `instrument`-legal) are fully or partially legal on an instrument track with a `distortion`
   or `eq3` effect in its chain — live-verified against a real "keys" instrument track carrying
   exactly that setup — yet neither ever appears as an option. The row reads as broken, not as a
   deliberate design choice, directly undercutting the Phase 27 Bug-4 fix that just shipped it.
   *Fix approach:* change `MacroRow`'s `applicable` filter to `m.kind === track.kind || m.kind ===
   'any' || m.targets.some(t => isParamLegalForKind(t.param, track.kind))` — reuse the function that
   already exists rather than inventing a second, looser one. (research/77 §2.3, P0 item 1)

2. **Four CSS custom properties are referenced throughout `styles.css` but were never actually wired
   into `:root` — two resolve to silent, undocumented fallback values everywhere; two more are
   shadowed by stale fallback hexes that no longer match the real token.** `:root` (`styles.css:1-12`)
   defines exactly nine custom properties — no `--danger`, no `--muted`, no `--good`. `var(--muted,
   #9aa0ab)` (4 uses, all Phase 27 Stream EG's note-inspector/note-name-readout/pitch-time-panel
   additions) and `var(--danger, #e06c75)` (3 uses: `.preset-picker-error`, `.macro-row-error`,
   `.lane-row-error`) both silently resolve to their fallback on every call site, because neither
   token was ever defined — `--muted` invents a *fourth* distinct "dim text" gray alongside the real
   `--text-dim`; `--danger`'s fallback color is independently reinvented two more ways elsewhere in
   the same file (`.arr-chip-btn.del:hover`'s hardcoded `#e06c75`, and `InstrumentPanel.tsx:230`'s
   inline `style={{ color: '#e06c75' }}` bypassing CSS entirely). Separately, `var(--text, #e6e8ec)`
   (~7 uses, e.g. `styles.css:1208,1244,1269`) and `var(--panel-2, #232630)` (`styles.css:1294`) *are*
   real, defined tokens — but their embedded fallback hexes have drifted from the actual values
   (`--text` is really `#d8dbe2`, not `#e6e8ec`; `--panel-2` is really `#23262e`, not `#232630`, a
   one-character copy/paste drift) — dead code today only because the real variable always wins at
   runtime, but actively misleading to anyone reading the CSS to learn what color body text or a
   recessed panel actually is. *Fix approach:* add real `--danger`/`--muted`/`--good` definitions to
   `:root` (promoting the colors already doing the most real work — see Stream FA below for the full
   token pass this bug fix is one part of) and delete or correct every stale/phantom fallback so a
   `var(--x, ...)` call site never lies about what `--x` resolves to. Ships as part of Stream **FA**.
   (research/79 §3.1)

3. **`.editor-title` is now fully dead code, superseded by Phase 27's own title bar, and still
   competing for space in an already-dense toolbar row.** `NoteView.tsx:890-892` still renders
   `track.name` a second time, in `track.color` plain text, immediately below the new
   `.noteview-titlebar` (Stream ED) that already shows the same name more prominently — bold, 15px,
   on a full-color background, versus this span's plain colored text on the page background. It's not
   just redundant, it actively crowds the Preview-clip button, the full keyboard-shortcut hint
   sentence, and the Place-in-Arrangement button that all share the same toolbar row. *Fix approach:*
   delete `NoteView.tsx:890-892` — a one-line diff, frees real width for what's left in that row.
   Ships as part of Stream **FD**. (research/76 §2.5, P0 item 2)

4. **A full-opacity, full-width, same-hue note visually fuses with the title bar directly above it —
   Phase 27's title bar (ED) and flat-opacity notes (EE) each landed correctly on their own but
   collide when stacked.** Scrolled to where a long note sits in the row just below the sticky
   `.noteview-titlebar`, the two render as one continuous same-color block with no visible seam
   (live-verified, `lead` track's near-full-loop-length C4 note against its own salmon title bar) —
   only the row's pitch label reveals they're actually two separate elements. Before EE, a
   loud-but-not-max-velocity note in that position would have rendered at reduced opacity, providing
   *accidental* visual separation; EE's own fix (flat, full-opacity notes, matching Ableton's own
   convention — correct on its own terms) removed that accidental buffer. `.noteview-titlebar`
   already has a `box-shadow: 0 1px 0 rgba(0,0,0,0.3)` (`styles.css:373`) meant to separate it from
   what's below, but a 1px 30%-black shadow reads as essentially invisible against a same-hue
   neighbor directly beneath it. *Fix approach:* give the title bar a harder seam — a 2-3px solid dark
   bottom border (matching the octave-line color already used elsewhere in this file), or a
   meaningfully more opaque/wider drop-shadow — cheap, self-contained, doesn't touch EE's own opacity
   fix. Ships as part of Stream **FD**. (research/76 §2.5/§3, P0 item 1)

## Streams

*P0/P1 items consolidated from all five docs' own priority lists, grouped by natural buildable unit.
Research 79's design-token findings touch every other stream's own `styles.css` blocks anyway, so
that pass is its own foundational stream (**FA**) landing first — the same logic Phase 27 applied to
its shared drag-state primitive (EB), just one level further down the stack this time. Research 75
(Arrangement round 2) found zero P0/P1 items — Phase 27 closed the surface's entire backlog — so
there is no Arrangement-specific stream this phase; its three P2 findings are folded into the
roadmap below instead.*

| Stream | Feature | Roadmap area | Primary files | Source research |
|---|---|---|---|---|
| FA | Design-token foundation: define real `--danger`/`--muted`/`--good` in `:root` (fixes bug 2's phantom/stale fallbacks), fold the four near-black literals (`#14151a`/`#1a1a1a`/`#0f1014`/`#1b1d23`) into `--bg` or one new `--surface-recessed` token, collapse border-radius to a real three-tier scale (`--radius-sm/md/lg`, migrating the orphaned 7px/10px uses), fix `InstrumentPanel.tsx:230`'s inline red hardcode, and reconcile the seven near-duplicate reds / four near-duplicate greens onto the new tokens file-wide now that the find/replace is trivial | — (bugfix + cross-cutting design-system foundation) | `ui/src/styles.css`, `ui/src/components/InstrumentPanel.tsx` | research/79 |
| FB | Typography & label consistency: one `--label-tracking` token (pick `0.05em`) replacing eight mixed em/px `letter-spacing` values across every uppercase group-label class, a shared `.section-heading`/`.panel-heading` class consolidating the four independently-invented panel-title conventions (`.editor-title`'s replacement text, `.library-rail-title`, `.overlay-title`, `.effect-chain-title`/`.macro-row-label`/`.param-group-title`) onto one CSS-driven case convention instead of hand-typed Title Case in JSX, one `--font-mono` token replacing the two monospace stacks | — (cross-cutting design-system) | `ui/src/styles.css`, `ui/src/App.tsx`, `ui/src/components/ArrangementView.tsx`, `ui/src/components/NoteView.tsx`, `ui/src/components/SynthPanel.tsx` | research/79 |
| FC | Keyboard-shortcut reference panel: a small topbar button (matching Browser/Mixer/History's existing pattern, `App.tsx:239-260`) opening a static, grouped list of the app's real shortcut surface — Shift+Tab, Undo/Redo, NoteView's select-all/copy-paste/delete/nudge/resize set, `Knob.tsx`'s Enter/Escape — replacing "three different disclosure mechanisms, no single place to see them all" with one | — (new small feature, closes a real discoverability gap) | `ui/src/App.tsx`, new `ui/src/components/ShortcutHelp.tsx`, `ui/src/styles.css` | research/79 |
| FD | Fix bugs 3-4 (dead `.editor-title`, titlebar/note visual collision) + extend the chance lane's already-shipped paint-across-notes drag gesture (`onChanceLanePointerDown/Move/Up`) to the velocity lane's own gesture (currently single-note-anchored) + give NoteView a local time-zoom control (`--note-step-w` currently a fixed 14px, entirely unresponsive to any gesture) + move the clip-loop range/handles off the overloaded `--accent` amber (now meaning five different things in one view) onto a hue not reused elsewhere in `NoteView` | Note editing (piano roll) | `ui/src/components/NoteView.tsx`, `ui/src/styles.css` | research/76 |
| FE | Fix bug 1 (`MacroRow`'s coarse track-kind filter) + align `InstrumentPanel.tsx`'s row order (picker → soundfont knobs → macros → chain) with `SynthPanel.tsx`'s established picker → macros → chain rhythm, folding the soundfont program/volume/pan block in as its own group alongside the effect chain instead of wedged between the picker and Macro row | Core effects / Macros | `ui/src/components/SynthPanel.tsx`, `ui/src/components/InstrumentPanel.tsx`, `ui/src/components/synthParams.ts` | research/77 |
| FF | Content Browser calibration: lift `.lib-type-icon`'s rest-state color off `var(--text-dim)` (identical to dim meta text today, so Phase 27's own type-differentiation fix only pops on hover/preview, not during an ordinary idle scan) to a value with real idle contrast; recalibrate the preview-pulse's peak alpha (`rgba(224,161,60,0.24)`, currently reads as a solid fill, not the "soft wash" its own code comment claims) or correct the comment to match the stronger effect actually shipped; fix `PreviewButton`'s active-state `❚❚` glyph, which blurs into an indistinguishable blob at its real 20px/9px size | Preset / content library | `ui/src/components/ContentBrowser.tsx`, `ui/src/styles.css` | research/78 |

Six streams (FA-FF) — smaller than Phase 27's ten, matching this round's own finding that Phase 27
closed most of the P0 backlog. No stream was forced into existence to hit a target count; every
remaining P1/P2 item that didn't consolidate into one of these six buildable units is folded into
`docs/product-roadmap.md` instead (see below).

## Merge order

Same "UI-heavy, `styles.css` is the hot file" shape as Phase 27, with one twist: this phase's first
two streams (FA, FB) are themselves editing the *shared token layer* other streams' CSS reads from —
the opposite of Phase 27's own discipline ("append to your own component's block, don't touch shared
variables"), which is exactly why they need to land first, not last.

- **`ui/src/styles.css`**: touched by five of six streams (FA, FB, FC, FD, FF — everyone except FE,
  which is almost entirely a TS logic/ordering fix). FA and FB are the two streams that legitimately
  need to edit `:root` and shared classes; FC/FD/FF should append to their own component's existing
  block, same discipline as Phase 27.
- **`ui/src/components/NoteView.tsx`**: FD only (versus five streams in Phase 27 — this file had its
  Phase 27 turn already; only one follow-up stream touches it this round).
- **`ui/src/components/SynthPanel.tsx`** / **`InstrumentPanel.tsx`**: FE only, plus FB's small
  title-markup touch (sequenced after FE to avoid overlapping the same panel's JSX twice in flight).
- **`ui/src/components/ContentBrowser.tsx`**: FF only, fully isolated, same as Phase 27's EJ.
- **`ui/src/App.tsx`**: FC only, isolated (a new topbar button + new component, following the
  Browser/Mixer/History precedent already there).

Suggested sequence:

1. **FA first** — the token foundation, including bug 2's fix. Every other stream's new CSS this
   phase should be written against real tokens, not a fourth or fifth ad hoc fallback hex added on
   top of the ones research/79 already found.
2. **FD and FE next**, either order (low file overlap with each other: `NoteView.tsx` vs.
   `SynthPanel.tsx`/`InstrumentPanel.tsx`) — both carry real bugs (3-4 and 1 respectively); land bug
   fixes before the remaining pure-polish streams, same "fix bugs first" precedent as Phases 26-27.
3. **FB** — the typography pass, sequenced after FA since it's the second half of the same
   token-consolidation effort (reuses FA's now-real tokens rather than inventing a sixth ad hoc
   value), and after FE so FB's `.section-heading` pass over `SynthPanel.tsx`'s title markup doesn't
   overlap FE's own row-reorder diff in flight.
4. **FC** — fully new files (one topbar button in `App.tsx` + a new component); no hard dependency on
   anything above, sequenced here for scheduling convenience only.
5. **FF** — fully isolated (`ContentBrowser.tsx` isn't touched by any other stream this phase); land
   last purely for scheduling convenience, same as Phase 27's EJ.

Re-run each prior stream's own live-verify script after every merge as a regression check — same
discipline as Phases 26-27.

## Verification

Each stream ships its own Playwright-driven live-verify script (`ui/verify-phase28-stream-f*.mjs`)
against a real `beat daemon` + built frontend, on a disposable copy of a fixture `.beat` file — never
`examples/night-shift-song.beat`, the owner's own live project, matching every research doc this
phase was built from. Because FA/FB are pure design-token/typography passes with no behavioral
surface of their own, "verified" for those two means asserting `getComputedStyle` actually resolves
`--danger`/`--muted`/`--good`/`--radius-*`/`--label-tracking`/`--font-mono` to real, non-fallback
values at every call site those tokens touch — not just that the app still renders. For FD/FE/FF,
"verified" means the same standard Phase 27 set: actual rendered DOM/CSS state (computed styles,
class presence, element bounding boxes), plus for FE specifically, a live instrument-track fixture
(soundfont + `distortion`/`eq3` in its chain, the exact repro research/77 used) confirming the Macro
row actually renders `grit`/`warmth` alongside `space`, not just that the filter code changed. Re-run
directly after merge, not trusted from a stream's own self-report, matching Phases 26-27's standard.

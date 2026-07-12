# Research 62 — Ableton comping (ch.21) vs dotbeat: a direct feature/UI comparison

*2026-07-12. Companion to `docs/research/43-ableton-comping.md` (the grounded text primer on
Ableton Live 12's manual chapter 21, pp.414-419). That doc already did the narrative reading; this
one is a different artifact — a structured, decision-oriented comparison table with priorities,
grounded in the same manual pages **plus direct viewing of all six of the chapter's screenshots**
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch21/p-414.jpg` through `p-419.jpg`).
Nothing here contradicts `docs/decisions.md` or `docs/product-roadmap.md`; where a row below
reflects an already-made call (e.g. D2's "LLM narrates, never judges alone," or the M4 gating of
audio recording), that call is treated as fixed, not re-litigated.*

**[manual p.NNN]** — cited from the chapter text/screenshots. **[dotbeat, file:line]** — read
directly from this repo this pass.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

These are cases where dotbeat already has a real, shipped answer to the same underlying need the
chapter describes — even though the UI shape usually differs.

- **Alternative clip content, auditioned and swapped.** Ableton's take lanes let you park several
  candidate clips on one track and switch which one is "live" **[manual p.414, §21.1]**. dotbeat's
  `track.clips[]` (an array of independently-named `BeatClip`s, `document.ts:705`) plus
  `BeatScene.slots` (`trackId -> clipId`, `document.ts:560-563`) already does the same job for
  MIDI/drum content: author several clips on a track, point a scene's slot at whichever one you
  want live via `setScene` (`edit.ts:984`), no format change needed. The UI shape is completely
  different (Ableton: parallel visual lanes under one track; dotbeat: named clips selected via
  scene assignment, no lane visualization) but the underlying "keep N candidates, pick one" data
  model already exists.
- **Non-destructive auditioning before committing.** Ableton's Audition Mode plays a take lane
  without altering the main lane **[manual p.417, §21.5]**. dotbeat's Vary/audition loop (`beat
  vary`, live-previewed via `setDoc`, committed only on Keep — `docs/product-roadmap.md`'s "Rungs
  1-3" and rung-2 "feel" rows) is the same shape: generate candidates, listen live, commit only the
  one you keep. Different trigger (parameter/content mutation vs. multi-take recording) but the
  same "preview before you commit" interaction pattern.
- **Non-destructive compositing (copy, don't mutate the source).** Ableton is explicit that a clip
  copied from a take lane into the main lane is an independent copy — editing the comp never
  touches the source take **[manual p.418, §21.6]**. dotbeat's `saveClip` (`edit.ts:964`) is the
  same operation: snapshot live content into a new named clip, leaving whatever it was copied from
  untouched.
- **Rename/duplicate/delete as first-class operations on the candidate-holding structure.** Ableton
  names Duplicate/Delete/Rename as explicit take-lane commands with keyboard shortcuts **[manual
  p.416, §21.2]**. dotbeat clips already support the equivalent generic operations through the
  existing edit-primitive/CLI surface (add/remove/rename apply to any `BeatClip`, not something
  special-built for takes) — no comping-specific gap here.

### b) In Ableton, not in dotbeat

- **Take lanes as a dedicated visual UI element.** A track can show N parallel horizontal lanes
  stacked under its main lane, each an audible/inaudible candidate, toggled with `Ctrl Alt U`/`Cmd
  Option U` **[manual p.414-415, §21.1, screenshots p.414-415]**. dotbeat has the *data* shape
  (sibling clips) but zero *visual* representation of "these clips are candidates for the same
  slot" — no lane stack, no show/hide toggle. Confirmed absent: nothing in `ui/src/` renders
  multiple clips as parallel lanes.
- **Segment-level splice into a composite ("Copy Selection to Main Lane," `Ctrl`/`Cmd`+Up/Down
  arrow to swap the take under a selection, Draw-Mode click-drag).** The actual compositing gesture
  **[manual p.418, §21.6, screenshot]** — replace *part* of the main lane (a bar range) with the
  corresponding span from a different take, not the whole clip. This is the single largest capability
  gap: dotbeat has no primitive that reads bars `[a,b)` from clip X into clip Y for either MIDI or
  audio content (confirmed absent from `src/core/edit.ts`, `cli/beat.mjs`, `src/mcp/server.ts` —
  already established in research 43 §7).
- **Recording-driven auto-lane creation.** Recording over an existing clip auto-adds a new take
  lane per pass, and the most recent take auto-copies to the main lane so it's immediately audible
  **[manual p.416-417, §21.3]**. Not applicable today — dotbeat has no audio recording capture path
  at all (`docs/product-roadmap.md`'s Audio-region clip editing table, "Native audio recording,"
  Not Started, gated M4), so there is nothing to auto-lane *from*.
- **Source highlighting: visual provenance of which take contributed which bars.** Once a comp
  exists, Ableton colors the contributing take-lane segments in the track's color and desaturates
  unused material, with a draggable boundary to shift the comp's split point **[manual p.419,
  §21.7, both screenshots]**. dotbeat has no equivalent live-decoration layer (nor the segment
  primitive it would decorate).
- **Per-take visual disambiguation (auto-randomized clip color per take).** A Theme & Colors
  setting that assigns a different color to each recorded take automatically **[manual p.417]**.
  Pure UI polish; no dotbeat equivalent, and nothing blocking it if segment-splice ever ships.
- **Cross-mode exclusivity with Automation Mode.** Take lanes hide automatically when Automation
  Mode is active, and entering either mode exits the other **[manual p.415, §21.1]**. Not
  applicable — dotbeat has no lane-based UI for this rule to apply to yet.
- **Drag samples/MIDI files directly onto take lanes as a chopping tool (use case (c), no
  recording involved).** **[manual p.417, §21.4]** dotbeat's content browser already drags presets/
  samples onto tracks (`docs/product-roadmap.md`'s "Content browser sidebar" row, Done) but not
  onto a *take-lane-shaped* target, because that target doesn't exist.
- **Auto-crossfade at comp seams ("Create Fades on Clip Edges," 4ms, `Ctrl Alt F`/`Cmd Option F`).**
  **[manual p.418, §21.6]** No equivalent — dotbeat has no audio-region crossfade mechanism at all
  yet (fade in/out handles are themselves listed Not Started in `docs/product-roadmap.md`'s
  Audio-region clip editing table).

### c) In dotbeat, not in Ableton

**dotbeat's git-native checkpoint/restore/pin system (`src/history/history.ts`) is a real, shipped,
differently-shaped answer to an adjacent problem — not a comping substitute, and it's worth being
precise about exactly where the substitution does and doesn't hold, per research 43 §7:**

- **Whole-document provenance that outlives the session.** Every `checkpoint` is a full-document
  git commit whose message is the semantic diff one-liner (`history.ts:206-235`); `history`
  (`history.ts:238-243`) and `collapsedHistory` (`history.ts:251-268`) surface that as a legible
  timeline; a `pin` (`history.ts:308-334`) is a named git tag, permanent and immune to the
  append-only `restore` model (`decisions.md` D10). Ableton's closest analog — source highlighting
  — is real-time UI decoration computed from live project state: it exists only while the project
  is open, is never itself stored, and answers only "what does the *current* comp look like," not
  "what did every past attempt look like and why." A pinned checkpoint answers both, permanently,
  and is `git log`-readable months later by a human *or an agent* with no DAW open at all.
- **"Just pick the best whole take" is already solved, free, no new machinery.** If each take is
  recorded/authored as a full document state (or, more precisely, a full `BeatClip` — the sibling-
  clips pattern from §1a above), checkpoint history already gives free comparison (`beat diff`
  between any two checkpoints reads as an edit list, not a binary diff — D8), free labeling (a pin
  name, `history.ts:308`), and an append-only "go back" (`restore`, `history.ts:275-297`) that never
  destroys the road not taken. This is real coverage of Ableton's use case (a) from the manual's own
  opening framing **[manual p.414]** for the common case where no sub-clip splicing is needed.
- **What it explicitly does *not* cover:** segment-level compositing. `restore` operates at
  whole-document granularity and chooses one entire past state wholesale; it cannot assemble bars
  `[1,4)` from take 2 and bars `[5,8)` from take 1 into one new thing. This is the same gap named
  in §1b — dotbeat's history mechanism answers "which whole version do I want," Ableton's comping
  answers "which fragments of which versions do I want, combined." They are genuinely different
  operations solving adjacent problems, not two UIs for the same feature. (Full argument: research
  43 §7, "The genuinely different, git-native shape of 'pick the best take.'")
- **Restore is append-only, unlike a take-lane deletion.** Ableton's "Delete All Unused Take Lanes"
  **[manual p.416, §21.2]** is a real, permanent deletion of unused material from the project.
  dotbeat's `restore` never deletes anything — going back to an earlier checkpoint takes a *fresh*
  checkpoint of the old bytes rather than rewriting history (`history.ts:270-274`'s own doc
  comment), so an abandoned take is never actually lost, just superseded. This is a stronger safety
  property than Ableton offers for the equivalent cleanup gesture, at the cost of the repo never
  shrinking on its own (an accepted tradeoff, not evaluated here).
- **Intent capture.** `checkpoint`'s optional `intent` field (`history.ts:206`, `HistoryEntry.intent`)
  records *why* an AI-agent-driven edit happened, trailer-encoded into the commit message. Ableton's
  chapter has no equivalent concept — take-lane provenance is "which audio," never "which prompt
  produced this."

---

## 2. Prioritized recommendations

Every row from **1(b)** gets a decision. Priorities: **P0** (build soon, clear pull), **P1** (worth
scoping, not urgent), **P2** (real but low-pull, revisit on signal), **Do-not-recreate** (the gap is
real but the dotbeat-native answer is already better or the Ableton mechanism doesn't fit dotbeat's
model).

| Feature | Priority | Build recommendation |
|---|---|---|
| Segment-level splice into a composite (`Ctrl`/`Cmd`+Up/Down swap, Copy Selection to Main Lane, Draw-Mode drag) | **P1** | The one gap worth real design investment, but not urgent — no demand signal yet (research 43 §8.4 confirms: no owner ask, no other research finding names it). When scoped: one new edit primitive in `src/core/edit.ts`, sized like `splitAudioClip` (`src/core/edit.ts:1271`) — read bars `[a,b)` from source clip X, splice into destination clip Y, format-neutral (notes/hits/audio regions all use the same bar-range operation). CLI/MCP first (`cli/beat.mjs`, `src/mcp/server.ts`), per D14's CLI-first sequencing — no GUI required to ship real value, since an agent or the CLI user can already name "which take, which bars" today. |
| Take lanes as a dedicated visual UI element (parallel lane stack under a track) | **P2** | Don't build a literal lane-stack UI yet — it's a rendering layer on top of the segment-splice primitive above (research 43 §8.2c), and building the visualization before the primitive exists would mean designing UI for data that doesn't exist. Once segment-splice ships and shows real usage, revisit as a `ui/src/` addition to the arrangement view (candidate clips shown as a collapsible sub-row under a track, reusing the existing clip-block rendering from `docs/research/30-ableton-clip-visualization.md`'s work rather than inventing new visual chrome). |
| Recording-driven auto-lane creation (auto-take per pass, last-take-to-main-lane) | **Do-not-recreate (for now)** | Correctly gated on M4 native audio recording, which doesn't exist yet (`docs/product-roadmap.md`'s "Native audio recording" row, Not Started, ~30ms web-latency wall per `docs/decisions.md` D3). Nothing to build until recording itself lands — re-scope as part of M4's own audio-comping design pass (research 43 §8.4's item (b)), not before. |
| Source highlighting (comp provenance shown as colored/desaturated take-lane segments) | **Do-not-recreate** | Deliberately don't port this. Once segment-splice exists as a real edit primitive, `git log -p`/`beat diff` on the destination clip already gives a strictly more durable provenance record than Ableton's session-only, non-persisted highlighting (§1c above; research 43 §8.3 makes the same call). If a GUI comping surface is ever built, a highlight overlay is a nice-to-have *rendering* of history data that already exists — not a new system to build in parallel. |
| Per-take auto-randomized clip color | **P2** | Trivial, cosmetic, and only meaningful once multiple candidate clips are visually stacked (i.e., depends on the P2 lane-UI row above). Bundle into that same future stream rather than scoping standalone — a few lines in whatever component renders the candidate-clip stack, reusing the existing track-color infrastructure tracks already have (`docs/product-roadmap.md`'s "Rename / recolor tracks" row). |
| Cross-mode exclusivity with Automation Mode | **Do-not-recreate** | dotbeat has no modal "Automation Mode" to begin with (automation is an always-visible lane per `docs/product-roadmap.md`'s Automation section, not a mode you enter/exit) — this Ableton rule is solving a UI-real-estate problem specific to Ableton's modal editing scheme. Not a gap; a non-fit. |
| Drag samples/MIDI onto take lanes as a chopping tool (no recording involved) | **P1** | Bundle with the segment-splice primitive above rather than scoping separately — once sibling-clips-as-candidates has a real UI surface (the P2 lane row), dropping a browser sample onto a candidate slot is a small extension of the existing content-browser drag-drop path (`ContentBrowser.tsx`, already wired for tracks/lanes per `docs/product-roadmap.md`'s "Content browser sidebar" row) rather than new infrastructure. |
| Auto-crossfade at comp seams ("Create Fades on Clip Edges," 4ms) | **P2** | Blocked on a real prerequisite that's independently already Not Started: region-level fade in/out handles (`docs/product-roadmap.md`'s Audio-region clip editing table). Don't scope comp-seam crossfading before that lands — once it does, auto-crossfade-at-splice-boundary is a small, natural extension of the same fade machinery, not a separate feature. |

**Overall read, consistent with research 43's own conclusion (§8.4):** the single highest-leverage
move is the segment-splice edit primitive (P1) — it is format-neutral, CLI/MCP-buildable today with
no M4 dependency, and it's the one piece of machinery every other row in this table either depends
on or is explicitly deferred behind. Everything else in 1(b) is either genuinely gated on work
already scheduled elsewhere (M4 recording), correctly not worth porting because dotbeat's
git-native provenance already beats it (source highlighting), or cosmetic polish that should ride
along with the primitive rather than being scoped alone. None of this is urgent enough to open a
dedicated stream on its own — no demand signal exists yet for MIDI/drum comping specifically — but
it is now scoped precisely enough that a future stream doesn't have to re-derive the shape.

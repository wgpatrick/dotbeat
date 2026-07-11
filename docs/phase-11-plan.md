# Phase 11 — Mac app as top priority

*Kicked off 2026-07-11, continuing the night-shift pattern. Owner direction, verbatim intent:
focus on the Mac app; set up several parallel workstreams; each does its own research/design
pass before building; owner isn't available for minor decisions, so calls are made and recorded
here rather than blocked on. The beatlab clip-automation fix from Phase 10 Stream D is now landed
as a PR (`wgpatrick/beatlab#5`) rather than left scratch-only — same "commit on a branch, open a
PR, owner reviews on their own time" pattern now applies to the beatlab-side streams below.*

**Decision made this session, recorded properly in `docs/decisions.md` D11**: new binary preset/
media content goes through git-lfs from now on (existing large blobs stay put; a history rewrite
to migrate them is the owner's call, not made here).

The Mac app is `desktop/` (Tauri shell) + `product-spec-desktop.md`'s D1-D5 milestones. D1
(shell) and D2 (selection/pointing) and D3 (history) are functionally done; D5's BYO-Claude-Code
half shipped in Phase 10. What's left to make it a *real, shippable* Mac app rather than a dev-mode
demo: D1's packaging gap, D4 (the "biggest pure-GUI lift," still entirely unbuilt), and D5's
second tier (the inline "vary this" affordance the product spec names as the differentiator demo:
"highlight the hi-hats, say change this up").

## Stream 1 — D1 finish line: a real packaged app

Research 13 (`docs/research/13-tauri-shell.md`) already answers the "how" here — no new research
pass needed, this is execution of an already-resolved design: `yao-pkg`/`pkg` compiles the Node
daemon to a per-target-triple binary under `src-tauri/binaries/`, declared in `bundle.externalBin`,
launched via `Command.sidecar()`. Today's scaffold (Phase 9 spike + Phase 10 Stream A hardening)
still spawns a plain `node cli/daemon.mjs` child and a `npx vite` dev server for beatlab — fine
for dev, not fine for something you'd actually launch without a terminal.

1. **Compile the daemon as a real sidecar binary** (`yao-pkg` or equivalent), wire it through
   `bundle.externalBin` + `Command.sidecar()` per research 13's recipe, so the app no longer
   depends on the user having Node on PATH.
2. **Bundle beatlab as a production build**, not a spawned dev server: `vite build` beatlab into
   static assets, serve them locally (or embed in the app bundle) instead of shelling out to
   `npx vite`. This removes the second Node-on-PATH dependency and the dev-server startup latency.
3. **One open strategic question worth 10 minutes of real research before committing to scope**:
   what does "shippable" mean right now — just running on the owner's own Mac (where an unsigned/
   ad-hoc-signed local build runs fine, Gatekeeper mostly blocks *downloaded* quarantined apps,
   not locally-built ones) vs. distributing to other machines (needs a paid Apple Developer ID +
   notarization, which research 13 already flags as a known `externalBin` notarization gotcha).
   Look this up for real (Apple's own docs / recent developer reports on Gatekeeper's actual
   local-build behavior), make the call, and say which target you built for and why — don't
   silently assume distribution-grade packaging when the owner only asked for a Mac app to use.
4. Launch the real packaged app (not `tauri dev`) and verify it actually works with no dev
   tooling assumptions — e.g. temporarily strip `node`/`npx` from `PATH` for the launch to prove
   the sidecar binary is really self-contained, then restore it.

Owns: `desktop/src-tauri/*`, `desktop/src/*`, `desktop/package.json`. Reads (doesn't modify) a
beatlab checkout to build it. Result appended to `docs/phase-9-tauri-spike-plan.md` (same doc
Phase 10 Stream A appended to — keep the D1 history in one place).

## Stream 2 — D4: the song view, first real slice

`docs/product-spec-desktop.md` §5 names this the desktop app's centerpiece screen and the
biggest pure-GUI lift, still entirely unbuilt: tracks as rows, bars as columns, notes visible
across the whole song (density-rendered when zoomed out), section boundaries labeled, and this is
where selection lives (drag across bars, click a track header, click a lane).

1. **Quick applied research first** (not a full adversarial pass — a focused, real search):
   rendering technique for a dense multi-track note timeline at song length — canvas vs SVG vs a
   virtualization approach, how similar tools (any open-source DAW/piano-roll React component)
   handle zoomed-out density rendering without redrawing every note every frame. Spend real time
   on this before writing the component; a wrong rendering approach here is expensive to redo.
2. **Design and build a first real slice**: a new view/component in beatlab rendering the actual
   arrangement (real scenes/clips/tracks from a real multi-scene `.beat` file, via the existing
   daemon bridge — not mock data), with drag-to-select wired into the selection protocol that
   already exists (`POST /selection`, the same one `beat vary --scope selection` already reads).
   Full polish (zoom levels, every interaction) is NOT expected in one stream — a genuinely
   functional first slice that renders real data and lets the owner drag-select a range is the
   bar. Say plainly what's deferred.
3. Verify against a real song: load `examples/night-shift-song.beat` (or build a fixture with
   several scenes if that one doesn't exercise multiple sections), confirm the view actually
   shows the right tracks/bars/notes, and confirm a drag-selection round-trips through
   `beat selection` on the CLI side (i.e. the daemon really received it).

Owns: new beatlab-side component file(s) (your call on naming/location, follow beatlab's existing
`src/components/` conventions — check what's there first). Do not modify `src/audio/engine.ts`
or `src/state/store.ts` beyond the minimum needed to wire selection through (if any) — this
stream is GUI, not engine; if you find yourself needing engine changes, that's a signal to scope
down rather than expand. This is beatlab-side: clone fresh from `main` (not the Phase 10 Stream D
fix branch — keep PRs independent), commit, push to your own branch, open a PR against
`wgpatrick/beatlab`, same pattern as the clip-automation fix. Result written to a new
`docs/phase-11-song-view.md` in *this* repo (what you built, what you verified, what's deferred,
the PR link).

## Stream 3 — D5 second tier: the inline "vary this" affordance

The owner's own scenario, verbatim from the product spec: *"I might highlight the drum track, or
the hi-hats, and be like, hey, change this up."* D2/Phase 9 already built the backend half
(`beat vary --scope selection` reads the daemon's current selection). What's missing is the GUI
affordance the product spec's own research (research 10) names as the pattern to copy: a
lightweight, *inline* trigger at the selection (Cursor Cmd+K, Photoshop's Contextual Task Bar) —
not a full chat panel, just "select something, a small control appears, click it, get variations
to audition."

1. Quick design pass: where does this control appear (a floating toolbar near the selection
   bounds?), what does triggering it do (call the daemon's existing selection-scoped vary
   endpoint — check whether the daemon needs a new HTTP route or whether `beat vary --scope
   selection` is CLI-only right now and needs an HTTP equivalent for the GUI to call directly;
   read `src/daemon/*.ts` in the dotbeat repo and `src/vary/vary.ts` before assuming), how are
   the resulting variants presented for audition (product spec: "auditionable — applied
   revertibly — hear it, then Keep/Undo").
2. Build the smallest real version of this that actually works end to end: select something in
   the GUI → click the affordance → hear/see a real variant batch → Keep or Undo actually applies
   or discards it. A minimal but real audition UI (even just a simple "variant 1 of N, Keep /
   Next / Undo" strip) beats a polished mock that doesn't actually call the backend.
3. Verify live: drive it for real (headless Chromium + the real daemon + a real project, same
   verification pattern every other stream tonight used), confirm a selection→vary→keep round
   trip actually changes the `.beat` file on disk.

Owns: new beatlab-side component file(s) + minimal, additive changes to
`src/state/dawBridge.ts` (if a new daemon call is needed) — if the daemon itself needs a new HTTP
route for this, that's a dotbeat-repo change too (`src/daemon/`), keep it small and additive, and
say so explicitly since it's outside beatlab's own repo boundary. Do not touch Stream 2's new
song-view component; if the affordance needs to appear inside the song view eventually, note that
as follow-up rather than reaching into Stream 2's in-flight work. Clone fresh from beatlab `main`,
own branch, own PR. Result in a new `docs/phase-11-vary-affordance.md` in this repo.

## Process

Same worktree-per-stream pattern. Streams 2 and 3 both touch beatlab but are asked to keep to new
files / additive changes and branch independently from `main`, so their PRs can merge in either
order without depending on each other — some manual conflict resolution on the beatlab side is
plausible if they touch a shared file (e.g. a selection hook) and is expected to be handled by
whichever PR merges second, same spirit as Phase 9's predicted-and-handled conflicts. Stream 1 is
fully disjoint (different repo area, different repo entirely for the beatlab build step which is
read-only). `npm test` in *this* repo should stay at 286/280/0/6 across all three streams, since
none of them touch this repo's `src`/`cli`/`test`.

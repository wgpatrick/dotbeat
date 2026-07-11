# Phase 15 Stream I — the vary-and-audition affordance (the "highlight the hats, run vary" demo)

*Built 2026-07-11. Rebuilds, properly in `ui/` this time, the single most-differentiating feature of
the product (`docs/product-spec-desktop.md` §1/§2/§3, ROADMAP D2/D5): the owner's exact scenario —
"I might highlight the drum track, or the hi-hats, and be like, hey, change this up." The backend
(`beat vary`, the D2 selection channel) has existed since Phase 9; this stream gives it a GUI surface
and closes the loop with a revertible, in-place audition.*

## What was built

### 1. Daemon route — `POST /vary` (`src/daemon/daemon.ts`, additive)

An HTTP face on `beat vary <file> <track> <group>` (rung-1 param variation), scoped by the daemon's
live pointing selection. It reuses core's real functions — `varyTrack` + `VARY_GROUPS` from
`src/vary/vary.ts` — and adds no variation logic of its own.

- **Request** (`{ track?, group?, count?, amount?, seed? }`, all optional): the daemon reads its own
  in-memory `selection` and resolves it via the new exported pure helper `resolveVaryTarget(sel, doc,
  body)`:
  - the **target track** = the request's `track`, else the single track the selection is "about"
    (its `tracks`/`lanes`/`notes` axes union to one), else the doc's selected/first track;
  - **enforced scope** (spec §2): if the selection names specific tracks and the resolved target
    isn't among them, it throws — a param-vary can't be aimed outside what's highlighted (the same
    structural guarantee `--scope selection` makes, that no pixel tool can);
  - the **group** = the request's `group`, else inferred from a selected drum lane
    (hat/openhat→`hats`, kick→`kick`, snare/clap→`snare`), else a per-kind default (drums→`hats`,
    synth/instrument→`filter`). So a selected drums track defaults to varying its hi-hats with no
    typing — the owner's demo.
- **Response**: `{ track, group, count, amount, seed, variants: [{ index, edits: [{path,value}],
  label }] }`. Each variant IS a small diff in the file's own `beat set` vocabulary (e.g.
  `drums.hatTone 6184.9183`); `label` drops the redundant `<track>.` prefix for terse display.
- **Read-only / revertible by construction**: `/vary` never writes the file. It only *generates* the
  batch. The GUI auditions a variant by applying its edits in-memory, and a *kept* variant is
  committed through the ordinary `POST /edit` path (one canonical line each). Nothing touches disk
  until Keep — the "applied revertibly, hear it, then Keep/Undo" model of spec §3.

### 2. GUI — the inline affordance (`ui/`)

- **`ui/src/components/VaryAffordance.tsx`** (new): a lightweight contextual bar (research 10's
  Photoshop-Contextual-Task-Bar / Cursor-Cmd+K pattern — *not* a modal or a separate page) that
  appears whenever there's a pointing selection, in any view. It reads the selection off the store;
  one click (`≈ vary hats`) calls `POST /vary` and enters an **audition strip**:
  `{group} on {track} · variant i of N · <edit summary> · [◀ Prev] [Next ▶] [Keep] [Undo]`.
  - Triggering snapshots the current document; each variant's edits are applied to that snapshot in
    memory via `setDoc`. Because the running audio engine re-reads the store document every tick
    (`ui/src/audio/engine.ts`, unchanged), the provisional variant is **genuinely heard live** while
    playback continues — not shown as text.
  - **Keep** replays the chosen variant's edits through `postEdit` (one canonical line each, on
    disk). **Undo** restores the snapshot. Disk changes only on Keep, and only to the variant the
    human actually chose.
- **`ui/src/daemon/bridge.ts`** (additive): `requestVary(body)` (the `POST /vary` client) and
  `applyEdits(doc, edits)` (applies a variant's edits in-memory, reusing the exact optimistic mirror
  `postEdit` already uses, so an auditioned variant matches what committing it produces).
- **`ui/src/App.tsx`** (additive): mounts `<VaryAffordance />` once, below the header, so it's
  available across the Editor / Arrangement / Mixer / History tabs.
- **`ui/src/styles.css`** (additive): the `.vary-bar` / audition-strip styling.

The selection gesture itself reuses what already exists (Phase 13): clicking a track header in the
Arrangement view posts `{tracks:[id]}`. Selecting the drums track → the affordance shows `≈ vary
hats` → audition → keep. (Lane-granular selection — clicking an individual hi-hat lane to scope the
vary to *just* that lane's group — is deferred; see below.)

## Verification — live, end to end (`ui/verify-phase15-vary.mjs`)

The whole loop is proven in headless Chromium against a real daemon on a real git-backed project
(`examples/night-shift.beat`), ending in a **real git diff proving the KEPT variant — not just any
variant — is what landed on disk**. This is the established GUI-verification pattern
(`ui/verify-phase13.mjs`/`verify-phase14.mjs`), not a unit test.

Checks: **V1** selecting the drums track reveals the inline `≈ vary hats` affordance; **V2** clicking
it returns a real 9-variant batch and enters audition — the store document (which the engine plays)
now holds a variant whose hi-hat params differ from the original, with the transport still running;
**V3** Next steps to a different variant (its params differ from variant 1's); **V4** Keep writes
exactly the auditioned variant's hi-hat params to disk.

Representative run (seed varies run-to-run — `varyTrack` is deterministic per seed, and the route
defaults the seed to the clock):

```
original hi-hat params:      {"hatTone":6500,   "hatDecay":0.04,   "openHatDecay":0.3}
[V2] variant 1 (auditioned): {"hatTone":6500,   "hatDecay":0.0589, "openHatDecay":0.3031}
[V3] variant 3 (auditioned): {"hatTone":6184.9183,"hatDecay":0.0346,"openHatDecay":0.2016}   ← kept
[V4] on disk after Keep:     {"hatTone":6184.9183,"hatDecay":0.0346,"openHatDecay":0.2016}   ✓ == kept, ≠ original, ≠ variant 1
```

The committed `git diff` (the whole point — the KEPT variant landed, in the file's own one-line-per-
change vocabulary):

```diff
@@ -1,7 +1,7 @@
 format_version 0.3
 ...
-selected_track lead
+selected_track drums                # from selecting the drums track
@@ -48,9 +48,9 @@ track drums drums #56b6c2 drums
-    hatDecay 0.04
-    openHatDecay 0.3
-    hatTone 6500
+    hatDecay 0.0346                  # exactly the kept variant (variant 3)
+    openHatDecay 0.2016
+    hatTone 6184.9183
```

(`hatDecay 0.0415`-style values where a param wasn't mutated in the chosen variant stay at the
original — `varyTrack` only edits the params it actually moved; the on-disk value still matches the
auditioned store value for all three keys, which is what V4 asserts.)

Screenshot: `ui/verify-p15-vary.png`. Full suite green: **`npm test` → 293 tests, 287 pass, 0 fail,
6 skipped** (the 6 are the pre-existing macOS tmpdir-symlink history-test skips, unrelated).

## What's deferred

- **Lane-granular selection in the GUI.** The daemon route *already* infers the right group from a
  selected drum lane (hat→hats, kick→kick, …) and enforces it, and is verified for lane selections
  at the resolver level. But the current GUI selection surfaces (Arrangement track/bar drag) don't
  yet let a human click an individual drum lane to select it — that gesture lives in
  `StepSequencer.tsx`, which is outside this stream's file ownership. So the shipped demo scopes at
  the *track* level (select drums → vary hats by default). Wiring a lane click to `postSelection`
  is a one-line follow-up in the step sequencer that will light up kick/snare-scoped varies too.
- **`feel` (rung-2) content variation over the affordance.** This stream ships rung-1 param variation
  (clean `beat set` one-line diffs, trivially auditionable and revertible). Auditioning humanized
  `feel` batches (`varyFeel`) — which rewrite note timing/velocity rather than a synth param — is a
  natural next increment; the audition/keep machinery here (snapshot + in-memory apply + commit)
  already generalizes to it.
- **Scoring the audition.** `beat score` / `beat suggest` (the taste-learning exhaust) aren't wired
  to the GUI Keep yet; a kept variant commits but doesn't append to `beat-scores.jsonl`.
- **Anchoring the bar at the selection.** The affordance is a contextual bar under the header (the
  Photoshop Contextual Task Bar analog), not pixel-anchored onto the canvas-rendered timeline —
  deliberately, to avoid fragile geometry math across three different views.

## Files

- `src/daemon/daemon.ts` — `POST /vary` route + exported `resolveVaryTarget` / `VaryRequestBody`
  (additive; Stream H's history routes already merged, no conflict).
- `ui/src/components/VaryAffordance.tsx` (new), `ui/src/daemon/bridge.ts` (`requestVary`,
  `applyEdits`, DTOs), `ui/src/App.tsx` (mount), `ui/src/styles.css` (styling).
- `ui/verify-phase15-vary.mjs` (new), `ui/verify-p15-vary.png` (evidence).

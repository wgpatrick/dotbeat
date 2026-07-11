# Phase 20 Stream Z — automation-lane UI

*Built on the merged Stream Q arrangement track-row shape (this worktree branched from
`origin/main`; expected, predicted conflicts with Streams V and W on `ArrangementView.tsx` are
resolved at merge — changes here were kept additive/localized to keep that merge clean). Adds the
missing GUI half of dotbeat's v0.9 clip automation: research 18 §7 already speced this from direct
Ableton observation — the "`<Device>/<Parameter>`" picker with +/- and a draggable breakpoint
curve — so this is a build, not a fresh design.*

## What was built

### 1. Per-track parameter picker (`ArrangementView.tsx`)

- Each track header gains a compact **`A` automation toggle**. It is disabled (with a tooltip)
  unless the track's clip actually plays in a scene, because v0.9 automation is **clip-scoped and
  only plays in song mode** — the engine returns an empty automation map in loop mode
  (`ui/src/audio/engine.ts` `contentFor`), so offering it there would be a dead control.
- Opening it drops an **add-a-lane strip**: a `<select>` of the automatable params for that track
  kind, labelled `"<track> / <Param>"` (or `"Track Vol"` / `"Track Pan"` for the mixer params),
  and a **`+ add lane`** button. The option list is derived from `synthParams.ts`'s `PARAM_GROUPS`
  (the same declarative table `SynthPanel` renders) filtered to `kind: 'knob'` — which is exactly
  the automatable set (`AUTOMATABLE_SYNTH_PARAMS` excludes only enums/bools). So both **mixer params
  (volume/pan)** and **any automatable synth param (cutoff, resonance, sends, EQ, drive, LFO
  rates, drum-voice params, …)** are offered, with no hand-maintained parallel list.
- Params that already carry points on the track's clip show as lanes **automatically** (no need to
  open the picker); the picker only adds *new* (initially empty) lanes. A per-lane **`×`** removes
  it (clears its stored points; an empty lane has no canonical serialized form, so the last removal
  drops the `auto` block).

### 2. Inline draggable curve (`ArrangementView.tsx`, canvas)

- Each shown param renders as its **own dedicated sub-lane below the track row**, full timeline
  width, aligned to the ruler/playhead. This is research 18 §7's explicitly-documented multi-lane
  presentation ("move an envelope into its own dedicated lane below the clip … a track can show many
  parameter lanes stacked at once") — the natural fit for the +/- picker. (The alternate same-row
  red-line overlay is noted as deferred below.)
- The curve is **canvas-rendered**, drawn across every section occurrence that plays the target
  clip, tiled every `loopBars*16` steps to match the engine's playback tiling. Breakpoints render as
  draggable markers; the curve holds the first/last value beyond the point range (matching
  `interpolateAutomation`'s clamping).
- Interaction follows research 15 §2's rendering discipline for continuously-interactive elements:
  a drag **redraws the canvas imperatively** and hits the network **only on pointer-up** — no React
  state and no POST per pointer move. Click empty space to **add** a breakpoint; drag a marker to
  **move** it; **alt-click** a marker to **remove** it. The x-position maps to clip-local 16th-step
  time (the occurrence under the pointer sets the reference frame); the y-position maps to the
  param's raw value using its `synthParams` min/max range.

### 3. Writes through the real automation primitive

- Curve edits can't use the `/edit` `{path,value}` grammar (they carry a `(clip, param, point)`
  tuple), so an additive daemon route **`POST /automate`** wraps the **same** core primitives
  `beat automate` / `beat_automate` use — `setAutomationPoint` / `removeAutomationPoint`
  (`src/core/edit.ts`), unchanged. It writes through the identical `writeIfChanged` path `/edit`
  uses, so a curve edit is a clean per-point line diff and the directory watcher hot-reloads the GUI
  through the ordinary external-edit path.
- `ui/src/daemon/bridge.ts` gains `postAutomation`, mirroring `postEdit`: it applies the edit
  optimistically to the store (a faithful local mirror of the two core primitives, id-mint included,
  so a freshly-drawn point keeps the id the daemon writes — no flicker on the SSE reconcile) and
  then POSTs `/automate`.

### Files touched (all additive/localized)

- `ui/src/components/ArrangementView.tsx` — picker toggle + `AutomationPicker` + `AutomationLane`
  components; `TrackRow` header split into a select button + a `headerExtra` slot (converges with
  the newer Phase-18 header shape, easing the V/W merge).
- `ui/src/daemon/bridge.ts` — `postAutomation` + optimistic mirror.
- `ui/src/types.ts` — typed `BeatClip.automation` (was `unknown[]`) with mirrored
  `BeatAutomationLane`/`BeatAutomationPoint`.
- `ui/src/styles.css` — automation lane/picker styles.
- `src/daemon/daemon.ts` — the additive `POST /automate` route.
- `ui/verify-phase20-automation.mjs` — the live verification harness (new).

## Verification evidence

`node ui/verify-phase20-automation.mjs` — headless Chromium driving the **real** frontend against a
**real** `beat daemon`, on a minimal song-mode fixture (one synth track `lead` playing clip `verse`
in a 4-bar section from bar 0; no LFO / no filter-env on cutoff, so `chain.filter.frequency` is
driven purely by the automation ramp). All five checks pass.

**Z1 — add a lane / empty-lane discipline.** Picking `cutoff` and clicking `+ add lane` shows the
sub-lane; the `.beat` file is **unchanged** (an empty lane has no serialized form).

**Z2 — draw two breakpoints → clean automation-only diff.** Two clicks produced exactly:

```diff
@@ -21,0 +22,3 @@ track lead lead #e06c75 synth
+    auto lead.cutoff
+      point p1 8 548.8235
+      point p2 48 18000
```

Times land in clip-local steps `[0,64)`; values in the cutoff range `[20,18000]`; nothing but
`auto`/`point` lines changed.

**Z3 — drag a breakpoint → exactly that point's line changes.**

```diff
@@ -24 +24 @@ track lead lead #e06c75 synth
-      point p2 48 18000
+      point p2 48 6101.4706
```

`+1/-1` line, only the dragged point.

**Z4 — playback follows the drawn curve** (Phase 10 Stream D's measurement approach: sample the live
Tone.js filter `AudioParam` during real playback, not a code read). Playing the project and sampling
`engine.chains.get('lead').filter.frequency.value` ~190 times across the loop:

- live cutoff **min = 548.82 Hz, max = 6101.47 Hz** — **exactly** the two drawn breakpoint values
  (`p1`→548.82, `p2`→6101.47). Nothing else drives cutoff in this fixture, so the live filter's
  sweep extremes equalling the drawn values is direct proof the curve is played.
- **step→cutoff correlation over the ramp region = 0.83** — cutoff rises with song time as the curve
  ramps low→high, so it hits the right values in the right temporal order (not just the right range).
- the static synth cutoff is 2000 Hz; an inert automation would have sat there.

**Z5 — alt-click removes a breakpoint.** Alt-clicking `p1` leaves exactly one point (`p2`).

Screenshot: `ui/verify-p20-automation.png`.

## Test / typecheck

- `npm test` (repo root, run because a daemon route was added): **293 tests, 287 pass, 0 fail, 6
  skipped.** This worktree branched from `origin/main`, whose suite is smaller than local `main`
  (which carries more later-merged streams, hence the plan's higher 295+/292+ absolute figures); the
  load-bearing fact is **0 failures** — the additive `/automate` route and the `BeatClip.automation`
  retype broke nothing.
- `ui/` typechecks clean (`npx tsc --noEmit`); core/daemon typecheck clean.

## What's deferred

- **Same-row red-line overlay.** Ableton's single-lane default draws the envelope over the clip
  content in the track's own row; this ships the multi-lane "dedicated lane below" presentation
  (research 18 §7) that suits the +/- picker. The overlay-on-row variant is a presentation option,
  not a data-model change — deferred.
- **Curved segments.** v0.9 stores points only (no interpolation column); the UI draws straight
  segments and the engine interpolates linearly (log-space for cutoff). Curve shapes need the
  deferred `interpolation` column in the `point` grammar (format-spec.md's v0.9 defers this).
- **Multi-clip automation per track.** The picker/curve target a track's **first-playing** clip;
  tracks that play *different* clips in different sections expose only that primary clip's automation
  for editing. Per-occurrence clip editing is a straightforward extension left for later.
- **Log-vs-linear y display.** The sub-lane maps values linearly on the y-axis even for
  log-ranged params (e.g. cutoff), while the engine interpolates cutoff in log space. Stored values
  are exact regardless; only the visual between-points slope differs. A per-param log y-axis is a
  cosmetic follow-up.
- **Loop-mode automation.** Clip automation only plays in song mode (engine design, Phase 13); the
  picker is correctly disabled for tracks not in any scene.

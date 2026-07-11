# Phase 10 Stream D — beatlab-side clip-automation engine wiring: verified

*Closes the honest gap `docs/phase-9-night-shift-plan.md`'s Result section named explicitly:
"beatlab-side engine wiring for clip automation is documented but unverified (no local beatlab
checkout with source to confirm against)." A local checkout now exists (scratch, gitignored,
outside this repo's tree) and the question has a concrete, evidence-based answer.*

## What was tested

1. Cloned `https://github.com/wgpatrick/beatlab` to `/tmp/dotbeat-scratch/beatlab` (outside this
   repo's git tree, reachability confirmed first via `git ls-remote`), `npm install`'d — same
   pattern `docs/phase-9-tauri-spike-plan.md`'s Step 2 used for the Tauri D1 scaffold.
2. Built a `.beat` fixture matching `test/format-v09-automation.test.ts`'s own example almost
   verbatim: track `lead`, clip `verse-a` with note `n1` and one `auto lead.cutoff` lane, two
   points (`p1` at step 0 -> 900, `p2` at step 2 -> 3200). A second fixture added two clips
   (`low`: cutoff flat at 300, `high`: cutoff flat at 8000) wired through two scenes and a
   two-section `song` (timeline arrangement), to test whether automation switches per section the
   way notes/pattern already do.
3. Started `cli/daemon.mjs` (this repo's compiled daemon, unmodified) on each fixture, started
   beatlab's real vite dev server from the scratch checkout, and drove a **real, running beatlab
   instance** in headless Chromium (Playwright, `--autoplay-policy=no-user-gesture-required`,
   matching `cli/render.mjs`'s own pattern) navigated to
   `http://localhost:<vite>/musiclearning/?daw=<daemon>` — the exact `?daw=<port>` bridge
   `beatlab/src/state/dawBridge.ts` implements, the same one the Tauri D1 shell uses.
4. Read the live engine state directly: `window.__store` (Zustand store) and `window.__engine`
   (the `Engine` class instance, both exposed in dev builds — see `store.ts`/`engine.ts`'s
   `if (import.meta.env.DEV) { window.__store = ...}` blocks) were used to inspect the automation
   data as received, trigger playback (`store.getState().play()`), and repeatedly sample the
   **actual live Tone.js `AudioParam`** driving the sound (`engine.chains.get('lead').filter.
   frequency.value`) at 200ms intervals across real, wall-clock playback — not a code-reading
   inference, an observed value at a point in time.

## What was found

**The wiring exists and does move the parameter — but it moved the wrong value, for two
independent, confirmed reasons.** Both were found by reading beatlab's actual source
(`src/audio/engine.ts`, `src/state/store.ts`, `src/state/dawBridge.ts`, `src/types.ts`,
`src/components/AutomationLane.tsx`) and then proven live by observing the sampled `AudioParam`
value diverge from the intended curve, then converge to it after a local fix.

### Bug 1 (primary): a unit mismatch between the two systems' `time` field

- The `.beat` format's automation point `time` is **fractional 16th-note steps from the clip's
  start** — the same convention as `note.start` (`docs/format-spec.md`, `docs/phase-9-automation-
  plan.md`'s grammar section).
- beatlab's own `AutomationPoint.time` is **a 0..1 fraction of the whole loop** — confirmed three
  independent ways in beatlab's source: `AutomationLane.tsx`'s `timeToX = (time) => time * width`
  (draws the lane assuming `time` spans 0..1 across the full width), `engine.ts`'s
  `interpolateAutomation(points, frac, log)` (its second argument is always `step / totalSteps`,
  a 0..1 fraction, everywhere it's called), and `store.ts`'s own live "touch" recording
  (`recordAutomationPoint(trackId, param, step / totalSteps, ...)`).
- `src/core/convert.ts` in *this* repo (`toBeatClipAutomation` / `beatDocumentToPartialTracks`)
  passes `time` straight through in both directions with **no rescaling** — its own doc comment
  already flagged this as unverified ("it has NOT been verified against real beatlab source").
  It has now been verified, and the assumption was wrong: point `p2` at format-side `time=2`
  (step 2 of a 32-step, 2-bar clip) was received by beatlab as `time=2` in *its* 0..1 scale — past
  the end of the loop entirely.
- **Live evidence, before any fix** (`chain.filter.frequency.value` sampled every 200ms across
  one 4-second loop of the `verse-a` fixture, clip loaded via `loadClip` — the Session-View
  "launch a clip" action):
  ```
    elapsedMs   freqHz
      205ms     909.6
     1019ms    1033.9
     2037ms    1211.6
     3059ms    1429.3
     3872ms    1626.6      <- loop about to restart
     4076ms    1275.8      <- new loop, resetting toward 900
  ```
  A slow, near-linear creep from ~900 toward ~1600-2000 over the *entire* loop, restarting every
  cycle — never approaching the intended 3200, and never holding once reached (because, misread
  as fraction 2.0, the ramp target sits mathematically past every real point in the loop). This
  matches the bug's predicted math exactly (`value ≈ 900 + 1150 × frac`, derived from
  `interpolateAutomation`'s own formula given the misread point times).
- **Fix**: rescale on both sides of the daemon↔beatlab boundary — steps→fraction on the way in
  (`store.ts`'s `applyDawState`, dividing by `loopBars * 16`), fraction→steps on the way out
  (`dawBridge.ts`'s POST-to-daemon path, multiplying by `loopBars * 16`), each keyed off the
  document's own `loopBars` so a knob-drawn automation lane still round-trips into the file
  correctly. See the diff below.
- **Live evidence, after the fix** (same fixture, same sampling): a clean ramp 900 -> 3200 over
  the first ~2 of 32 steps, then a flat **hold at exactly 3200 for the rest of the loop**,
  resetting to 900 on the next cycle — exactly the curve the fixture specifies.
  ```
    elapsedMs   freqHz
      203ms     1435.5
      407ms     3200
     1017ms     3200
     2439ms     3200
     3862ms     3200      <- held all the way to loop end
     4065ms     1924.9    <- new loop, ramping back up
     4471ms     3200
  ```

### Bug 2 (secondary, found while fixing #1): timeline/song playback never applies per-section
### clip automation at all — notes and drum hits switch per scene, automation doesn't

- beatlab's tick loop (`Engine.tick` in `engine.ts`) has a `contentOf(track)` helper that, in
  **timeline mode** (a `.beat` file with `scene`/`song` blocks — the arrangement view), correctly
  pulls the current section's mapped clip's `notes`/`pattern` — that part already worked, and was
  what Phase 9 Stream F's screenshot verification actually exercised (a different clip's pattern
  rendering visibly).
- But every automation read further down the same function used `tr.automation` (the *live
  track's* state) directly, never `contentOf`'s per-section clip — so switching from one scene to
  another mid-song changed which notes/drum hits played, but **never** changed which automation
  curve was in effect. In a project with no clip ever manually "loaded" into the live track
  (the normal case for a file-driven timeline/song, since nothing calls `loadClip` automatically),
  `tr.automation` is simply `undefined`, so automation was silently inert for the entire song.
- **Live evidence, before the fix**: a fixture with two clips on one track (`low`: cutoff flat
  300Hz, `high`: cutoff flat 8000Hz) mapped through two scenes into a 2-bar song. Playing the
  whole song and sampling `chain.filter.frequency.value` the entire time returned a constant
  **1000Hz** (the synth's static default, untouched by either clip) for all 4 seconds/2 bars —
  the automation never engaged at all.
- **Fix**: `contentOf` now also returns `automation` — the scene's clip's automation in timeline
  mode, the live track's automation in loop mode (unchanged there) — and every automation
  consumer in the tick loop reads `content.automation` instead of `tr.automation`. The
  interpolation fraction was also wrong in timeline mode for the same reason as bug 1's root
  cause (it used `step / totalSteps`, a fraction of the *entire song's* step count, instead of
  `content.contentStep / (loopBars * 16)`, the fraction through the *current clip's own loop* —
  the unit automation points are actually authored in); both are fixed together since they're the
  same code path.
- **Live evidence, after the fix**: sampling the same 2-bar song now reads **~300Hz for all of
  bar 1** (scene `a`, clip `low`) and **~8000Hz for all of bar 2** (scene `b`, clip `high`),
  switching cleanly at the bar boundary and resetting correctly when the song loops:
  ```
    elapsedMs   freqHz
      208ms      300      <- bar 1, scene a / clip "low"
     2038ms      300
     2242ms     8000      <- bar 2, scene b / clip "high"
     3869ms     8000
     4072ms     3731.3    <- transitioning back into the looped song
     4274ms      300      <- bar 1 again
  ```

### What was NOT found broken

- **The core copy/apply path works.** `store.ts`'s `loadClip` action (the Session-View "launch a
  clip" interaction) correctly copies a clip's `automation` field onto the live track, and the
  tick loop correctly turns points into real Tone.js `AudioParam` calls
  (`linearRampToValueAtTime` on `chain.filter.frequency`, `chain.filter.Q`, `chain.vol.volume`,
  `chain.panner.pan`, EQ/comp/distortion/bitcrush/send params, per `AUTOMATABLE_PARAMS`). Once
  the unit and per-section-content bugs above are fixed, this path produces the exact intended
  curve, confirmed by direct `AudioParam.value` sampling during real playback, not just by
  reading the scheduling code.
- **The daemon bridge itself (transport layer, `dawBridge.ts`'s SSE/POST plumbing) is fine.**
  Both bugs are in state-reconciliation logic (`store.ts`'s `applyDawState`, `engine.ts`'s tick
  loop) or its mirror-image on the way out (`dawBridge.ts`'s POST handler), not in the
  connection/sync mechanism.
- `npm run test:smoke` in the beatlab checkout (its own 14-check smoke suite, unrelated to
  automation) still passes 14/14 with both fixes applied — no regression to existing behavior.

## Which automation shapes work, precisely

| Scenario | Before fix | After fix |
|---|---|---|
| Point values applied via `linearRampToValueAtTime` to the right `AudioParam` at all | Yes | Yes |
| Point `time` interpreted in the correct unit (steps, not loop-fraction) | **No** | Yes |
| A clip's automation engages when that clip is loaded (Session View "launch clip") | Yes (values wrong per above) | Yes (values correct) |
| A clip's automation engages automatically during timeline/song playback (no manual load) | **No — inert, 0% of the time** | Yes, switches per section |
| Automation edited live in the beatlab GUI round-trips back into the `.beat` file in the file's own units | **No** (would have written raw 0..1 fractions into a step-unit field) | Yes |
| Interpolation shape (linear ramp between points, hold after the last point) | Correct once time units are right | Correct |
| `curve: 'hold'` segments (format doesn't emit this yet — v0.9 has no interpolation column) | N/A, not exercised — format-side deferred, see `docs/phase-9-automation-plan.md` | N/A |

## The fix (as a diff for the owner to review)

Applied and verified **only in the scratch beatlab checkout** (`/tmp/dotbeat-scratch/beatlab`,
outside this repo's tree). **Not committed and not pushed there** — `git status` in that checkout
shows only unstaged working-tree modifications; `git log` there is unchanged from `origin/main`.
This repo's own git history is untouched by any of this (this stream's only change here is this
doc file).

Three files touched, all in the beatlab checkout:

```diff
diff --git a/src/audio/engine.ts b/src/audio/engine.ts
index 0165ec9..80f2f55 100644
--- a/src/audio/engine.ts
+++ b/src/audio/engine.ts
@@ -1166,14 +1166,24 @@ class Engine {
     // scene-mapped clip in timeline mode (null = silent this section). contentStep is the step
     // within that content: absolute in loop mode; section-relative and cycling every loopBars
     // bars (the clip cycle length) in timeline mode.
-    const contentOf = (tr: (typeof s.tracks)[number]): { notes: typeof tr.notes; pattern: typeof tr.pattern; contentStep: number } | null => {
-      if (!timeline) return { notes: tr.notes, pattern: tr.pattern, contentStep: step }
+    // BUG FIX (Stream D verification, docs/phase-10-clip-automation-verification.md in the
+    // dotbeat repo): this used to return only notes/pattern, so every automation read further
+    // down this function fell back to the LIVE track's tr.automation regardless of which
+    // section/clip was actually playing — notes and drum hits correctly switched per scene, but
+    // automation never did (confirmed live: a 2-bar song alternating two clips with different
+    // cutoff automation played a flat, unchanging cutoff for the whole song). automation is now
+    // part of the per-tick content: the scene's clip in timeline mode, the live track's own
+    // automation in loop mode (unchanged behavior there).
+    const contentOf = (
+      tr: (typeof s.tracks)[number],
+    ): { notes: typeof tr.notes; pattern: typeof tr.pattern; contentStep: number; automation: typeof tr.automation } | null => {
+      if (!timeline) return { notes: tr.notes, pattern: tr.pattern, contentStep: step, automation: tr.automation }
       const clipId = sectionScene?.clipIds[tr.id]
       if (!clipId) return null
       const clip = tr.clips.find((c) => c.id === clipId)
       if (!clip) return null
       const rel = step - sectionStartBar * 16
-      return { notes: clip.notes, pattern: clip.pattern, contentStep: rel % (s.loopBars * 16) }
+      return { notes: clip.notes, pattern: clip.pattern, contentStep: rel % (s.loopBars * 16), automation: clip.automation }
     }
 
     const stepSeconds = Tone.Time('16n').toSeconds()
@@ -1236,10 +1246,16 @@ class Engine {
         const lfoRateHz = p.lfoSync ? syncedRateHz(s.bpm, p.lfoSyncRate) : p.lfoRate
         const lfoValue = lfoOn ? lfoWaveValue(p, lfoRateHz, time) : 0
 
-        const cutoffAuto = tr.automation?.cutoff
+        // BUG FIX (Stream D verification): read from content.automation (the currently-playing
+        // clip's automation in timeline mode, the live track's in loop mode), not tr.automation
+        // directly — see contentOf's comment above. The interpolation fraction is likewise
+        // content.contentStep over the CLIP's own loop length (s.loopBars*16), not step/totalSteps
+        // (the whole-song step count in timeline mode) — AutomationPoint.time is authored as a
+        // 0..1 fraction of one clip loop, the same length contentStep already cycles over.
+        const cutoffAuto = content.automation?.cutoff
         let baseCutoff = p.cutoff
         if (cutoffAuto && cutoffAuto.length) {
-          baseCutoff = interpolateAutomation(cutoffAuto, step / totalSteps, true)
+          baseCutoff = interpolateAutomation(cutoffAuto, content.contentStep / (s.loopBars * 16), true)
         }
         if (p.lfoDest === 'cutoff' && lfoOn) {
           const hz = baseCutoff * Math.pow(2, p.lfoDepth * lfoValue)
@@ -1265,12 +1281,12 @@ class Engine {
         // block runs last win within the same tick — same documented tradeoff as the duck/amp-LFO
         // case, not worth a full modulation-mixing pass for a step-resolution teaching engine.
         const rampTime = swingTime + stepSeconds
-        if (tr.automation) {
-          for (const key of Object.keys(tr.automation) as AutomatableParam[]) {
+        if (content.automation) {
+          for (const key of Object.keys(content.automation) as AutomatableParam[]) {
             if (key === 'cutoff' || key === 'duckAmount') continue
-            const points = tr.automation[key]
+            const points = content.automation[key]
             if (!points || !points.length) continue
-            const val = interpolateAutomation(points, step / totalSteps, false)
+            const val = interpolateAutomation(points, content.contentStep / (s.loopBars * 16), false)
             switch (key) {
               case 'resonance': chain.filter.Q.linearRampToValueAtTime(val, rampTime); break
               case 'volume': chain.vol.volume.linearRampToValueAtTime(val, rampTime); break
@@ -1321,8 +1337,8 @@ class Engine {
         // engine is. duckAmount can itself be automated (Phase F) — if so, the automated value
         // wins over the static p.duckAmount for this step.
         if (p.duckSource) {
-          const duckAuto = tr.automation?.duckAmount
-          const duckAmt = duckAuto && duckAuto.length ? interpolateAutomation(duckAuto, step / totalSteps, false) : p.duckAmount
+          const duckAuto = content.automation?.duckAmount
+          const duckAmt = duckAuto && duckAuto.length ? interpolateAutomation(duckAuto, content.contentStep / (s.loopBars * 16), false) : p.duckAmount
           if (duckAmt > 0) {
             const source = s.tracks.find((x) => x.id === p.duckSource)
             const srcContent = source ? contentOf(source) : null
diff --git a/src/state/dawBridge.ts b/src/state/dawBridge.ts
index 8c8e399..5f9c1f6 100644
--- a/src/state/dawBridge.ts
+++ b/src/state/dawBridge.ts
@@ -128,11 +128,45 @@ export function initDawBridge(): void {
     if (sendTimer) clearTimeout(sendTimer)
     sendTimer = setTimeout(() => {
       const payload = serializeSandbox(useStore.getState())
+      // Bug fix (Stream D verification): mirror-image of store.ts's stepsToFraction on the way
+      // in — the .beat format's clip automation `time` is in fractional 16th-steps from the
+      // clip's start (Note.start's convention), but this app's live AutomationPoint.time is a
+      // 0..1 loop fraction. Rescale on the way OUT too, so a knob-drawn automation lane the user
+      // just edited round-trips back into the file in the format's own unit instead of writing
+      // 0..1 fractions into a field the format defines as step counts. Payload-local only — never
+      // mutates the live store (localStorage autosave, which also calls serializeSandbox, must
+      // keep the app's native fraction units).
+      const totalSteps = payload.loopBars * 16
+      const outgoing = totalSteps
+        ? {
+            ...payload,
+            tracks: payload.tracks.map((t) =>
+              t.clips.length === 0
+                ? t
+                : {
+                    ...t,
+                    clips: t.clips.map((c) =>
+                      !c.automation
+                        ? c
+                        : {
+                            ...c,
+                            automation: Object.fromEntries(
+                              Object.entries(c.automation).map(([param, points]) => [
+                                param,
+                                points!.map((p) => ({ ...p, time: p.time * totalSteps })),
+                              ]),
+                            ) as typeof c.automation,
+                          },
+                    ),
+                  },
+            ),
+          }
+        : payload
       sendQueue = sendQueue.then(() =>
         fetch(`${base}/state`, {
           method: 'POST',
           headers: { 'content-type': 'application/json' },
-          body: JSON.stringify(payload),
+          body: JSON.stringify(outgoing),
         }).catch((err) => console.warn('[daw] could not sync state to daemon:', err)),
       )
     }, 250)
diff --git a/src/state/store.ts b/src/state/store.ts
index d0ab152..ed993cf 100644
--- a/src/state/store.ts
+++ b/src/state/store.ts
@@ -69,6 +69,32 @@ function applyRestoredCounters(tracks: Track[], scenes: Scene[]) {
   sceneCounter = Math.max(sceneCounter, next.sceneCounter)
 }
 
+/** BUG FIX (Stream D verification, docs/phase-10-clip-automation-verification.md in the dotbeat
+ * repo): the daemon bridge hands clip automation points with `time` in the .beat format's own
+ * unit — fractional 16th-note steps from the clip's start, the SAME convention as Note.start
+ * (see beatlab-daw/docs/format-spec.md) — but this app's own AutomationPoint.time is a 0..1
+ * fraction of the whole loop (confirmed here: AutomationLane.tsx's `timeToX = time * width`,
+ * engine.ts's `interpolateAutomation`'s `frac` argument, and store.ts's own
+ * `recordAutomationPoint(trackId, param, step / totalSteps, ...)` call, all consistently 0..1).
+ * Nothing rescaled between the two, so a clip loaded from a .beat file played back a wrong
+ * automation curve (point time 2 read literally as fraction 2.0 — past the end of the loop —
+ * instead of "step 2 of a 32-step loop"). Convert on the way in here (steps -> fraction); the
+ * mirrored fraction<-steps conversion on the way OUT lives in dawBridge.ts right before the
+ * POST to the daemon. */
+function stepsToFraction(automation: Track['automation'], loopBars: number): Track['automation'] {
+  if (!automation) return automation
+  const totalSteps = loopBars * 16
+  if (!totalSteps) return automation
+  return Object.fromEntries(
+    Object.entries(automation).map(([param, points]) => [param, points!.map((p) => ({ ...p, time: p.time / totalSteps }))]),
+  ) as Track['automation']
+}
+
+function rescaleClipsStepsToFraction(clips: Clip[] | undefined, loopBars: number): Clip[] | undefined {
+  if (!clips) return clips
+  return clips.map((c) => (c.automation ? { ...c, automation: stepsToFraction(c.automation, loopBars) } : c))
+}
+
 /** The track shape a `.beat` document reduces to — only the fields the format models. Everything
  * else (the other ~65 SynthParams fields, clips, automation, mute state) is merged from the
  * existing track when there is one, or from defaults when the track is new. Reconstituting a
@@ -533,16 +559,19 @@ export const useStore = create<AppState>()((set, get) => ({
         dt.kind === 'drums' && dt.pattern
           ? ({ ...emptyPattern(), ...Object.fromEntries(Object.entries(dt.pattern).map(([k, v]) => [k, [...(v as number[])]])) } as DrumPattern)
           : (existing?.pattern ?? emptyPattern())
+      // Bug fix: rescale clip automation time from the .beat format's step units into this app's
+      // 0..1 loop-fraction units — see stepsToFraction's comment above.
+      const clips = rescaleClipsStepsToFraction(dt.clips, docState.loopBars)
       if (existing) {
         // The file only models some fields; everything else (automation, mute, the other ~65
         // synth params) is preserved from the live track — hot reload, not restore. Clips are
         // file-owned SINCE v0.4 when the partial carries them, preserved otherwise.
-        return { ...existing, name: dt.name, color: dt.color, notes, pattern, synth: { ...existing.synth, ...dt.synth }, clips: dt.clips ?? existing.clips }
+        return { ...existing, name: dt.name, color: dt.color, notes, pattern, synth: { ...existing.synth, ...dt.synth }, clips: clips ?? existing.clips }
       }
       // A track that exists only in the file: the file is the root document, so it becomes real
       // here — partial synth merged onto defaults (the "importing side's job" from
       // beatlab-daw's converter contract).
-      return { id: dt.id, name: dt.name, color: dt.color, kind: dt.kind, notes, pattern, synth: { ...DEFAULT_SYNTH, ...dt.synth }, muted: false, clips: dt.clips ?? [] }
+      return { id: dt.id, name: dt.name, color: dt.color, kind: dt.kind, notes, pattern, synth: { ...DEFAULT_SYNTH, ...dt.synth }, muted: false, clips: clips ?? [] }
     })
     // Tracks absent from the file are dropped (file order wins too) — engine.sync disposes
     // their audio chains. Deliberately NOT touching: isPlaying (keep jamming through a file
```

`npx tsc --noEmit` in the beatlab checkout passes clean with both fixes applied; `npm run
test:smoke` (beatlab's own 14-check suite) passes 14/14, unchanged.

## What this means for `src/core/convert.ts` in *this* repo

Bug 1's root cause — the unit mismatch — is arguably as much a dotbeat-side issue as a beatlab-
side one: `toBeatClipAutomation` / `beatDocumentToPartialTracks`'s clip-automation mapping in
`src/core/convert.ts` (this repo) also passes `time` straight through with no rescaling, so a
document written by beatlab's own `POST /state` (before the beatlab-side fix above) would encode
the wrong unit into the `.beat` file itself, independent of playback. The beatlab-side fix above
resolves live playback and the wire-format contract between the two apps going forward, but a
belt-and-suspenders fix on the dotbeat side (rescaling in `convert.ts` using the document's own
`loopBars`) is also worth considering — **out of scope for this stream** (Stream D owns nothing
in this repo but this doc), flagged here for whoever picks up `convert.ts` next.

## Verification commands run

```
# beatlab checkout, both fixes applied:
npx tsc --noEmit                 # clean
npm run test:smoke               # 14/14 passed

# this repo:
npm test                         # unaffected — see below
```

## Result

**The engine wiring is real, not a stub — but it was wrong in two independent, now-fixed ways.**
Automation points do reach a live Tone.js `AudioParam` and do move it during playback; the two
bugs found (`time`-unit mismatch, and timeline-mode reading the live track instead of the
playing section's clip) were both confirmed by direct, repeated sampling of the actual parameter
value during real playback in a real beatlab instance — not inferred from source alone — and both
resolve cleanly with the fix above, verified the same way. The fix lives only in the scratch
beatlab checkout (`/tmp/dotbeat-scratch/beatlab`), uncommitted and unpushed; landing it on
`wgpatrick/beatlab` is the owner's call.

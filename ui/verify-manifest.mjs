// ui/verify-manifest.mjs — the verify fleet's index and lifecycle record (W1.5 / R6-8 step 2).
//
// Until now the fleet had no runner and no roster: 102 scripts, each documenting one-off manual
// invocation in its own header, with "the full verify suite" existing only as prose in phase plans
// and, in practice, as an agent remembering to hand-run some of them. That is also how it grew to
// ~27k LOC with ten dead members nobody noticed — no document anywhere sanctioned RETIRING a
// verify script, so none were.
//
// This file is that missing lifecycle, in the cheapest form that works: one row per script.
//
//   area    what it verifies — the axis you actually select on when a refactor touches one
//           surface ("run everything tagged effects").
//   tier    engine | gui | both | cli
//             engine  the assertion is on REAL RECORDED AUDIO off window.__engine.recordWav.
//                     These are the engine's only real regression gate (there is no node --test
//                     coverage of engine.ts at all) and are what `npm run verify:engine` runs —
//                     the command R6-2/R6-3 need before engine.ts can be safely decomposed.
//             gui     the assertion is on the DOM and the on-disk .beat file.
//             both    audio AND DOM assertions in one script.
//             cli     no browser at all — drives `beat`/MCP directly. (The brief's tier vocabulary
//                     is engine|gui|both; `cli` is added rather than folding these five into
//                     "engine", which would make `verify:engine` mean two different things.)
//   status  live | legacy
//             live    expected to pass against current main; `npm run verify` runs it.
//             legacy  known not to pass, kept deliberately, with the reason stated. NOT a skip
//                     that reads as a pass — the runner reports legacy scripts as skipped-with-
//                     a-reason and they are excluded from the pass rate.
//
// Retirement rule (the thing that was missing): a script whose UI affordance is deleted is
// retired in the SAME commit as the affordance. A script that is broken but still the only
// coverage of a real invariant is marked `legacy` with the reason, never silently left `live`.
//
// Paths are relative to the repo root.
//
// ---- BASELINE: `npm run verify:engine`, 2026-07-25 (W1.5), 9/14 = 64% -------------------------
// The first time this tier has ever been run as a suite. Recorded because a pass rate nobody
// wrote down is a pass rate nobody can tell has moved. The five failures, diagnosed but NOT fixed
// (out of W1.5's scope — each is someone's real finding):
//
//   verify-osc2-fix            2 of 5 fields fail their own bar: osc2Level moved the spectral
//                              centroid 100Hz / LUFS 0.7, osc2Detune 39Hz / -1.3. The store DID
//                              update both times, so this is "the value reaches the graph but
//                              barely changes the sound", not a wiring break. subLevel /
//                              noiseLevel / unisonVoices all pass comfortably.
//   verify-phase26-stream-da   [AUTOMATION-VS-LFO] smoothed pan balance shows correlation 0.000
//                              against a left->right automation ramp (bar: < -0.85). Exactly zero
//                              is suspicious — it reads as "pan automation did not move at all".
//                              Worth a real look; the script's other checks (incl. the post-fader
//                              send tap) pass.
//   verify-phase37-stream-ra   Not a rendering failure at all: `beat feedback --sections --json`
//                              printed valid JSON and exited 1, because feedback sets exitCode 1
//                              when a screen finding has severity >= 3 or the arc diff fails
//                              (cli/beat.mjs). The script runs it through execFileSync, which
//                              throws on ANY non-zero exit, so a deliberately-extreme test song
//                              trips its own success path. This is R1-F5's "the exit-code
//                              meanings are not centrally documented" biting.
//   verify-phase36-stream-pc   EADDRINUSE on 127.0.0.1:8479 — its hardcoded daemon port was held
//                              by a `beat daemon` from an unrelated concurrent session. Purely
//                              environmental, and precisely the hazard verify-lib's pickPort
//                              removes; it will stop happening when this script is ported.
//   verify-phase22-audio-region FLAKY, not failing: three runs gave 14/14, 13/14 ([GAIN
//                              automation] delta 2.4dB vs a > 3dB bar) and 13/14 (a DIFFERENT
//                              check, the trim comparison). Real-time capture in headless
//                              Chromium against onset-relative windows; roughly 1-in-3 runs trips
//                              some threshold. Needs calibration, not a widened constant.

/** @typedef {{ script: string, area: string, tier: 'engine'|'gui'|'both'|'cli', status: 'live'|'legacy', note?: string }} VerifyEntry */

/** @type {VerifyEntry[]} */
export const VERIFY_SCRIPTS = [
  // ---- engine tier: assertions on real recorded audio ------------------------------------------
  { script: 'ui/verify-audio-track-fx.mjs', area: 'audio-region', tier: 'engine', status: 'live' },
  { script: 'ui/verify-clip-automation-render.mjs', area: 'automation', tier: 'engine', status: 'live' },
  { script: 'ui/verify-lane-polyphony.mjs', area: 'drums', tier: 'engine', status: 'live' },
  { script: 'ui/verify-instrument.mjs', area: 'instrument', tier: 'engine', status: 'live' },
  { script: 'ui/verify-osc2-fix.mjs', area: 'synth', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase22-audio-region.mjs', area: 'audio-region', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase22-stream-ac.mjs', area: 'effects', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase23-stream-bd.mjs', area: 'effects', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase23-stream-be.mjs', area: 'effects', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase26-stream-da.mjs', area: 'engine-core', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase26-stream-dh.mjs', area: 'synth', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase26-stream-dl.mjs', area: 'synth', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase35-stream-of.mjs', area: 'drums', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase36-stream-pc.mjs', area: 'audio-region', tier: 'engine', status: 'live' },
  // Phase 41 Stream A. Note its shape: the fleet's recordWav() helper defaults to play-then-settle-
  // 250ms-then-record, so every OTHER audio-region script structurally cannot see a missed
  // DOWNBEAT — which is exactly the bug this one exists for. It arms the recorder first (render's
  // order) and, because the audible symptom is a race a fast machine can win, its real gate is the
  // deterministic [COLD PLAY] pair rather than the audio assertions.
  { script: 'ui/verify-phase41-stream-a.mjs', area: 'audio-region', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase37-stream-ra.mjs', area: 'render-export', tier: 'engine', status: 'live' },
  { script: 'ui/verify-phase37-stream-rc.mjs', area: 'automation', tier: 'engine', status: 'live' },
  {
    script: 'ui/verify-surge-gui-playback.mjs',
    area: 'surge',
    tier: 'engine',
    status: 'live',
    note:
      'SKIPS (exit 0, with the reason printed) unless surgepy is available — it is a source build of Surge XT ' +
      'with no PyPI wheel, so most machines have nothing to render. Where it does run it is the only end-to-end ' +
      'proof that a surge track makes a sound in the GUI at all, and it reports the edit->hear round trip ' +
      '(measured 2026-07-27: 1123 ms for a 4-bar phrase, 3778 ms for 24 bars). Points at the owner-private ' +
      'twin-souls-study project by default; SURGE_PILOT_PROJECT/SURGE_PILOT_FILE aim it anywhere.',
  },
  {
    script: 'ui/verify-phase18-lfo-depth.mjs',
    area: 'synth',
    tier: 'engine',
    status: 'legacy',
    note:
      'Known-broken since the v0.10 note fields landed, diagnosed in ui/verify-phase26-stream-da.mjs:160-166: ' +
      'it builds its document via setDoc() (bypassing parse()) and omits chance/cent/ratchet*, so chanceFires() ' +
      'reads undefined as "never fires" and its note is silent — it fails at its very first check. Kept, not ' +
      'deleted, because it is the ONLY engine-side exercise of the tempo-sync-LFO mirror (R6-13 #5): deleting it ' +
      'would remove coverage, not dead weight. Fixing it is a small, separate, audio-affecting change.',
  },

  // ---- both: audio AND DOM ---------------------------------------------------------------------
  { script: 'ui/verify-phase20-render-export.mjs', area: 'render-export', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase22-stream-aa.mjs', area: 'effects', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase22-tracks.mjs', area: 'drums', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase23-stream-bf.mjs', area: 'effects', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase24-stream-ch.mjs', area: 'transport', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase24-stream-ci.mjs', area: 'arrangement', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase24-stream-cj.mjs', area: 'transport', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase26-stream-dc.mjs', area: 'effects', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase26-stream-de.mjs', area: 'mixer', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase26-stream-di.mjs', area: 'automation', tier: 'both', status: 'live' },
  { script: 'ui/verify-phase26-stream-dk.mjs', area: 'drums', tier: 'both', status: 'live' },
  // Phase 41 Stream C. 'both' because C8 renders the project with and without the drawn lane and
  // asserts on the resulting audio's time-resolved spectral centroid — a GUI-tier run would prove
  // the points were written and nothing about whether they are heard.
  { script: 'ui/verify-phase41-stream-c.mjs', area: 'automation', tier: 'both', status: 'live' },
  { script: 'ui/verify-volume-fader-bugfix.mjs', area: 'mixer', tier: 'both', status: 'live' },

  // ---- gui tier: DOM + on-disk .beat assertions ------------------------------------------------
  { script: 'ui/verify-focus-deeplinks.mjs', area: 'daemon-sync', tier: 'gui', status: 'live' },
  // Not the daemon GUI — the `beat ab` feedback page, a self-contained node:http app like
  // `beat rate`/`beat board`. It still needs a browser, so it belongs in the gui tier.
  { script: 'ui/verify-ab-page.mjs', area: 'owner-feedback', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase16-velocity.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase17-arrangement.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  {
    script: 'ui/verify-phase18-layout.mjs',
    area: 'layout',
    tier: 'gui',
    status: 'legacy',
    note:
      'A TENTH dead script, found by actually running it during W1.5 rather than by grep. R6-8 kept it because ' +
      'its Q1 check asserts the four-tab .view-tab switcher is ABSENT — true and still passing. But Q3 onward ' +
      'wait on `[data-testid="bottom-pane"] .stepseq`, the StepSequencer that Phase 22 Stream AB deleted ' +
      '(0 hits for "stepseq" anywhere in ui/src; the component file is gone), so the run blocks 5s and throws ' +
      'at Q3 — pre-existing, reproducible against origin/main. Kept, not deleted: Q1/Q2 are the only assertions ' +
      'anywhere that the Phase 18 layout rewrite stayed rewritten. Reviving it means repointing Q3-Q4 at the ' +
      'unified drum editor that replaced the step sequencer.',
  },
  { script: 'ui/verify-phase19-length.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase20-automation.mjs', area: 'automation', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase20-tracks.mjs', area: 'project-tracks', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase22-af.mjs', area: 'project-tracks', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase22-content-browser.mjs', area: 'content-browser', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase22-stream-ag.mjs', area: 'clips-scenes', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase23-bb.mjs', area: 'gui-bundle', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase23-stream-ba.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase23-stream-bc.mjs', area: 'audio-region', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-ca.mjs', area: 'layout', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-cb.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-cc.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-cd.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-ce.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-cf.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase24-stream-cg.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase25-effects-panel-redesign.mjs', area: 'effects', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase26-stream-db.mjs', area: 'history-undo', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase26-stream-dd.mjs', area: 'macros', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase26-stream-df.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase26-stream-dg.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase26-stream-dj.mjs', area: 'clips-scenes', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ea.mjs', area: 'gui-bundle', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-eb.mjs', area: 'drag-drop', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ec.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ed.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ee.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ef.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-eg.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-eh.mjs', area: 'effects', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ei.mjs', area: 'synth-panel', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase27-stream-ej.mjs', area: 'content-browser', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase28-stream-fa.mjs', area: 'layout', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase28-stream-fb.mjs', area: 'layout', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase28-stream-fc.mjs', area: 'keyboard', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase28-stream-fd.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase28-stream-fe.mjs', area: 'synth-panel', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase28-stream-ff.mjs', area: 'content-browser', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase29-stream-ga.mjs', area: 'clips-scenes', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase29-stream-gb.mjs', area: 'synth-panel', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase29-stream-gc.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase29-stream-gd.mjs', area: 'daemon-sync', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase29-stream-ge.mjs', area: 'copy-dialogs', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase29-stream-gf.mjs', area: 'layout', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase30-stream-ja.mjs', area: 'drums', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase30-stream-jb.mjs', area: 'history-undo', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase30-stream-jc.mjs', area: 'clips-scenes', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase30-stream-jd.mjs', area: 'project-tracks', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase30-stream-je.mjs', area: 'audio-region', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase31-stream-ka.mjs', area: 'clips-scenes', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase31-stream-kb.mjs', area: 'daemon-sync', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase31-stream-kc.mjs', area: 'note-editor', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase31-stream-kd.mjs', area: 'synth-panel', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase31-stream-ke.mjs', area: 'copy-dialogs', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase32-stream-la.mjs', area: 'context-menus', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase32-stream-lb.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase41-stream-d.mjs', area: 'arrangement', tier: 'gui', status: 'live' },
  { script: 'ui/verify-phase36-stream-pd.mjs', area: 'audio-region', tier: 'gui', status: 'live' },

  // ---- cli tier: no browser; drives `beat` / MCP directly --------------------------------------
  { script: 'scripts/verify-phase22-stream-ad.mjs', area: 'pitch-time', tier: 'cli', status: 'live' },
  { script: 'scripts/verify-phase33-stream-mb.mjs', area: 'cli-mcp-parity', tier: 'cli', status: 'live' },
  { script: 'scripts/verify-phase33-stream-mc.mjs', area: 'cli-errors', tier: 'cli', status: 'live' },
  { script: 'scripts/verify-phase33-stream-md.mjs', area: 'cli-correctness', tier: 'cli', status: 'live' },
  { script: 'scripts/verify-phase33-stream-me.mjs', area: 'macros', tier: 'cli', status: 'live' },
  // D20: two --offline renders of an all-noise project must be sample-identical. Tier `cli`
  // because it drives `beat render` rather than asserting inside the page, but what it gates is
  // engine audio — pilot 109's HIGH finding, which had been closed by editing the help text.
  { script: 'scripts/verify-offline-noise-reproducible.mjs', area: 'render-determinism', tier: 'cli', status: 'live' },
]

export const TIERS = ['engine', 'gui', 'both', 'cli']

/** Select by tier, area, name substring, and status. One place owns the semantics so the runner
 * cannot disagree with the manifest.
 *
 * Tier matching is EXACT — `--tier engine` does NOT pull in the `both` scripts, even though those
 * do contain audio assertions. `verify:engine` has to stay the tight ~14-script gate R6-2 asked
 * for (a command an engine refactor runs after every step); folding in the 12 `both` scripts
 * doubles it with runs whose slow half is DOM driving. Use `--tier both` or `npm run verify` for
 * the wider net. */
export function selectScripts({ tier = null, area = null, filter = null, includeLegacy = false } = {}) {
  return VERIFY_SCRIPTS.filter((e) => {
    if (!includeLegacy && e.status !== 'live') return false
    if (tier && tier !== 'all' && e.tier !== tier) return false
    if (area && e.area !== area) return false
    if (filter && !e.script.includes(filter)) return false
    return true
  })
}

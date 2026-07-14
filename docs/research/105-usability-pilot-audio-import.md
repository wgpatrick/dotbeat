# 105 — Usability pilot: audio import → scaffold → fill → render

**Date:** 2026-07-14
**Surface:** CLI (`cli/beat.mjs`) and MCP (`beat mcp` / `dist/src/mcp/server.js`)
**Type:** Exploratory usability pilot (no checklist), per `docs/usability-testing.md` "Variant: CLI/MCP pilots"
**Pilot persona:** A producer who loves the structure of a finished reference track and wants to start a NEW dotbeat song that matches its tempo + section layout, then fill it with a groove and get to something audible.

## Goal & setup

Three things to accomplish, discovered only from `--help` / tool descriptions / errors:
1. Point dotbeat at reference audio → get tempo + sections.
2. Scaffold a new `.beat` from that structure.
3. Fill the sections with real content and reach a render I could hear.

No real reference file on hand. Worked in `/tmp/pilot105`. Real model backends (beatthis/allin1) are not installed here — part of the test was whether the degraded/stub path is discoverable and usable.

End result: **I reached an audible 30 s render (-22.2 LUFS, bass-heavy) via the full pipeline on both CLI and MCP** — but hit one real content trap, one near-blocker on render, and a headline-feature caveat, detailed below.

## Session narration

### 1. Discovering the importer

`beat --help` is a very long wall of text (every subcommand inline). `beat analyze --help` was focused and clear, and crucially points at `beat skeleton` and `beat analyze --doctor`.

`beat analyze --doctor` — genuinely excellent, told me exactly where I stood:
```
backends:
  stub      ok
  beatthis  missing: torch, beat_this
  allin1    missing: allin1, natten, madmom
```

### 2. Needing a WAV; default backend fails

I had no reference track. `presets/` only holds one-shot drum samples (`kick.wav`, etc.), not a song. I first pointed `analyze` at `kick.wav` with the default backend:
```
$ beat analyze ./ref.wav
error: beat analyze (beatthis) failed: pip install -r python/requirements-beatthis.txt — run `beat analyze --doctor` to check the Python backends
```
The error points at `--doctor` but does **not** mention that `--backend stub` is a no-deps fallback (doctor literally lists stub as "ok"). I only knew to try stub because the help text mentioned it in passing.

`--backend stub` worked, and its output chained me forward nicely:
```
$ beat analyze ./ref.wav --backend stub
analyzed ./ref.wav (backend stub 0.1.0)
  bpm 120.00 (backend)
  duration 0.29s · 0 beats · 0 downbeats
  sections (3): intro / loop / outro
  wrote /tmp/pilot105/ref.analysis.json
  next: beat skeleton <out.beat> /tmp/pilot105/ref.analysis.json
```
`kick.wav` is 0.29 s, so the sections were degenerate. I synthesized a 32 s 120-BPM structured WAV with a few lines of node and re-ran. Stub emitted `intro 0→4.8s / loop 4.8→27.2s / outro 27.2→32s` — always exactly three sections (intro/loop/outro) at fixed ~15/70/15 proportions, and **always** `bpm 120.00`, regardless of content.

### 3. Scaffolding

```
$ beat skeleton mysong.beat ./song.analysis.json
created mysong.beat
tempo 120 (detected 120)
  #  scene   bars  start
   0  intro      2  0.00s
   1  loop      11  4.80s
   2  outro      2  27.20s
next: beat clip / beat place to fill the 3 scene(s) with content
```
Clean. Produced a synth `lead` track, three empty scenes, and a matching `song` block. (The 11-bar loop is an artifact of stub proportions → odd bar count a producer would rarely choose, but expected.)

### 4. Filling — and the silent-render trap

Added a `drums` track (12-lane kit, good) and tried `add-track ... bass instrument`:
```
error: instrument tracks need a soundfont: pass --soundfont <sample-id> [--program N] (register the .sf2 with beat sample first)
```
So I used a `synth` track for bass instead (frictionless). Programmed a 4-on-the-floor kick, backbeat snare, 8th hats, and a root bassline. `inspect` confirmed the content on the tracks.

Then I rendered — a naive user's next move — **before** placing anything into scenes:
```
$ beat render mysong.beat -o render1.wav      # (after CHROME_PATH workaround, below)
wrote render1.wav
$ beat metrics render1.wav
loudness   -Infinity integrated
spectrum   sub 0% | bass 0% | mids 0% ...
```
**The render was completely silent** and nothing warned me. In song mode the timeline plays only scene-placed content; my live-track groove played nowhere. `inspect` shows `scene intro: (empty)` next to `notes: 4` on a track, but there's no cross-warning that a track has content placed in no scene, and `render`/`metrics` happily produced a valid, silent WAV.

Completing the intended `clip`→`scene` workflow fixed it:
```
$ beat clip mysong.beat drums drumloop
$ beat clip mysong.beat bass bassloop
$ beat scene mysong.beat loop drums=drumloop bass=bassloop
$ beat scene mysong.beat intro drums=drumloop
$ beat scene mysong.beat outro drums=drumloop
```
Re-render → `-22.2 LUFS, sub 28% | bass 51%` — audible, kick-and-bass mix. Goal reached. The clip/scene/place trio worked first try once found.

### 5. Render dependency near-blocker

First render died:
```
browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
Run "npx playwright install chrome"
```
`npx playwright install chrome` fails here — the Google `.deb` download is blocked by the proxy (`CONNECT tunnel failed, response 403`). `npx playwright install chromium` succeeded, but `render` is hardcoded to `channel: 'chrome'` and won't use it. Only after checking source did I find the **undocumented** escape hatch `CHROME_PATH` (`render.mjs:107`). Setting `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` made every render work. A user without source access would be stuck at "I made a song but can't hear it."

### 6. MCP surface

Drove `beat mcp` over stdio (initialize → tools/list → tools/call). 65 tools. `beat_analyze_audio` and `beat_skeleton` both present.
- `beat_analyze_audio` ran the stub analysis and returned a concise cached-artifact result.
- I guessed `beat_skeleton` args as `out`/`analysis` (matching the CLI positional names) and got a **great** error: `unknown arguments "out", "analysis" for beat_skeleton (valid: out_file, analysis_file, section_bars)`. Retried with `out_file`/`analysis_file` → worked.
- The `beat_analyze_audio` MCP description is thorough and honestly states stub is "a deterministic 120-BPM no-dependency grid" and that only allin1 "also labels sections" — better disclosure than the CLI gives.

## Findings

### HIGH — Silent render after adding content to live tracks (song mode plays only scenes)
After `beat skeleton`, a natural first move is: add tracks, program a groove, render. In song mode that renders **silence** with zero warning, because only scene-placed content plays. Repro: scaffold → `add-hit`/`add-note` on tracks → `beat render` → `beat metrics` shows `-Infinity LUFS`. `inspect` shows `(empty)` scenes beside populated tracks but never connects the two.
**Fix direction:** Warn on `render`/`inspect` when a track has live content that is placed in no scene of the active song (e.g. "track 'drums' has 8 hits but appears in 0 scenes — song mode won't play it; snapshot with `beat clip` and place it"). Even a one-line note in `skeleton`'s `next:` hint ("your tracks won't be heard until their clips are placed in scenes") would help.

### HIGH — `render` hard-requires the Chrome channel; the `CHROME_PATH` fallback is undocumented
`render` launches `channel: 'chrome'`. When Chrome is absent the error says `npx playwright install chrome`, which fails in any locked-down/proxied env (403 on the Google download). An installed Playwright **chromium** is not used. The only workaround, `CHROME_PATH`, appears nowhere in `render --help`, the error text, or docs — I found it only by reading `render.mjs:107`. This was effectively a blocker to the "hear it" half of the goal.
**Fix direction:** Fall back to bundled Playwright chromium automatically when the chrome channel is missing; and/or document `CHROME_PATH` in `render --help` and print it in the not-found error ("or set CHROME_PATH to an existing Chromium binary").

### MEDIUM — The headline "learn from a real song" is only real with backends that aren't installed; the CLI output can mislead
The default backend `beatthis` gives beats/downbeats but **not** section labels (per the MCP description, only `allin1` labels sections), and both are missing here. `stub` — the only working path — is a **fixed 120-BPM intro/loop/outro grid** that reflects neither the reference's real tempo nor its arrangement. Yet the CLI `analyze` prints `bpm 120.00 (backend)` and a plausible 3-section table with no "this is a synthetic grid, not your song" caveat, so a user could believe their reference was truly analyzed. (The MCP tool description is honest about this; the CLI is not.)
**Fix direction:** In CLI `analyze` output, badge the stub result clearly (e.g. "stub backend — synthetic 120-BPM grid, NOT detected from audio; install beatthis/allin1 for real detection"). Consider having `skeleton` echo the backend/`bpmMethod` and warn when it scaffolds from a stub artifact.

### MEDIUM — Default-backend failure doesn't mention the `--backend stub` escape hatch
`beat analyze <wav>` with no backend fails with a `pip install` hint and a pointer to `--doctor` (which reports stub "ok"), but never says "or run with `--backend stub` for a no-deps grid." A user just wanting to try the pipeline may think they're blocked on installing torch.
**Fix direction:** Append "— or use `--backend stub` for a dependency-free test grid" to the failure message.

### LOW — MCP argument names are inconsistent across the two importer tools
`beat_analyze_audio` takes `file` / `out`; `beat_skeleton` takes `out_file` / `analysis_file`. My natural guess (`out`/`analysis`, mirroring the CLI positionals) failed. Mitigated by an excellent error listing valid names, but the inconsistency is a small papercut.
**Fix direction:** Align on one convention (e.g. `file`/`out_file` everywhere), or accept aliases.

### LOW — `beat_analyze_audio` MCP schema marks nothing required
`inputSchema.required` is `[]`, so `file` isn't required even though it's essential unless `doctor:true`. An agent could call it with no args.
**Fix direction:** Express the real constraint (require `file` unless `doctor` is set), or at least mark `file` required.

### LOW — `add-track ... instrument` demands a soundfont with no "just use synth" nudge
For a quick bassline, `instrument` is the intuitive type but errors demanding a registered `.sf2`. The error is clear about the fix but doesn't hint that a `synth` track needs no setup.
**Fix direction:** Optionally suggest "for a quick part with no sample, use `synth`" in that error.

### POLISH — Stub proportions yield odd section bar counts (11-bar "loop")
Expected given the stub's fixed proportions and duration math, but a scaffold a producer would hand-edit. Not a bug.

## What worked well

- **`beat analyze --doctor`** — immediately answered "what can I even run here," per-backend, with the missing pip deps named. Best single affordance in the flow.
- **Chained `next:` hints** — `analyze` → `beat skeleton` → `beat clip / beat place` walked me through the whole pipeline without reading docs. The `skeleton` section table (scene/bars/start) is clear and reassuring.
- **The stub path is genuinely usable** — it produced a valid `*.analysis.json` that `skeleton` consumed with no fuss, so the plumbing is testable end-to-end with zero Python deps.
- **The `clip` → `scene` → `place` workflow worked first try** once discovered, and `scene ... drums=drumloop bass=bassloop` is a pleasant, terse syntax.
- **`render` → `metrics` loop** gave me an objective way to catch the silent render (a producer listening in a GUI might miss silence in a quiet intro; the LUFS number made it unambiguous).
- **MCP is solid**: 65 tools, thorough/honest tool descriptions, and the unknown-argument error that enumerates valid names turned a failed call into a one-retry recovery.

## Verdict

The pipeline (analyze → skeleton → fill → render) is real and works on both CLI and MCP, and the degraded stub path is discoverable enough to exercise it. The two things most likely to strand a real producer are (1) the **silent render** when content lives on tracks but not in scenes — no warning anywhere — and (2) the **render's hard Chrome dependency** with an undocumented `CHROME_PATH` fallback. The headline "learn from a real song" also over-promises relative to what's installable here: the only working backend fabricates a fixed 120-BPM grid, and the CLI doesn't flag that clearly.

## Resolution (same day, Phase 38 Stream SE)

Four findings — the cheap, high-value ones on Phase 38's own surface — were fixed the same day the pilot ran:

- **MEDIUM (stub over-promises):** CLI `analyze` now badges a stub result with a `⚠ stub backend — synthetic fixed 120-BPM grid, NOT detected from your audio` caveat + a pointer to `--doctor`. (`cli/beat.mjs` analyze output; regression-guarded in `test/analyze-sidecar.test.ts`.)
- **MEDIUM (escape hatch hidden):** the default-backend (`beatthis`) missing-dependency failure now appends `, or --backend stub for a dependency-free scaffold grid`. (`src/analysis/sidecar.ts`; regression-guarded.)
- **HIGH (silent-render trap), partial:** `beat skeleton`'s `next:` hint now spells out that song mode plays only scene-placed content, so a groove on a track is **silent until snapshot with `beat clip` and placed via `beat scene`/`beat place`**. `beat render --help` carries the same note. (`src/analysis/import.ts`, `cli/beat.mjs`.) The broader cross-warning on `render`/`inspect` (detect a populated track that appears in zero scenes and warn) is the real fix and is backlogged.
- **HIGH (render Chrome dep), partial:** the Chrome-not-found launch failure now throws an actionable message naming `CHROME_PATH` with a concrete example instead of leaking Playwright's raw error, and `beat render --help` documents the env var. (`cli/render.mjs`, `cli/beat.mjs`.) Auto-falling-back to a bundled Playwright chromium is the fuller fix and is backlogged.

Backlogged (tracked in `scripts/roadmap-data.mjs`, "Known usability gaps"): the `render`/`inspect` orphaned-track cross-warning; automatic bundled-chromium render fallback; the two importer tools' MCP arg-name inconsistency (`file`/`out` vs `out_file`/`analysis_file`) and the un-`required` `file` schema; the `add-track instrument` "just use synth" nudge. The stub-proportion odd bar count is expected behavior, not tracked.

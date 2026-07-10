# Phase 1 build plan — the file becomes the source of truth (ROADMAP M1)

> **STATUS: COMPLETE (2026-07-10).** All exit criteria met, with measured latencies — see
> "Result" at the bottom. Same discipline as `phase-0-plan.md`: a narrow vertical slice with a
> falsifiable exit test, measured against real code. Kept as-written so the reasoning stays
> visible; check marks show what's done.

Phase 0 proved the format round-trips and renders. It also exposed — in its own limitations
notes — the two things it did *not* prove, and they're both the same gap from different angles:

1. **The file is not yet the real source of truth.** `beat render` can only overlay a `.beat`
   document onto tracks that already exist in the default sandbox groove; it can't create tracks,
   and drum tracks don't survive the converter at all (`droppedTracks` in every
   `ConversionReport`). The app's built-in default state is still the true root document.
2. **Nothing syncs.** A GUI edit doesn't reach the file; a file edit doesn't reach the GUI. The
   two flows `docs/architecture.md` calls "a GUI knob-turn" and "a `vim` edit" are designed but
   unbuilt — and they're the actual M1 exit criteria in `ROADMAP.md`.

There's also an unmeasured number hiding in here that M3 depends on: **edit-loop latency**. The
whole agent-critique loop (M3) assumes an agent can edit the file and quickly observe the result.
Nobody has measured file-edit→GUI-applied or GUI-edit→file-written time yet. Phase 1 instruments
both.

## What the research already settled (don't re-decide, just apply)

- **The browser↔daemon boundary is a small typed protocol, never shared state.** openDAW's
  UI↔engine split works — and makes headless use nearly free — because the two sides only ever
  talk through a typed RPC layer over a message channel (`docs/opendaw-notes.md` §2). Our
  equivalent: the daemon exposes three tiny HTTP endpoints; the browser side is one bridge module
  that owns *all* applying-external-state logic. The render CLI then reuses that same bridge
  entry point instead of keeping its own hand-rolled overlay — one apply path, two consumers,
  exactly the shape that made openDAW's headless harness cheap.
- **Canonical serialization is the sync mechanism, not just a diff nicety.** D4/D7 (Humdrum's
  canonical-ordering discipline) means two identical documents produce byte-identical text — so
  "should the daemon write?" and "is this watcher event an echo of my own write?" are both plain
  string comparisons. No dirty flags, no vector clocks, no timestamps. This is the payoff of
  having frozen a deterministic format first.
- **Human slugs make the diffs reviewable** (D6): the one-line diff a knob-turn produces reads
  `trk lead / cutoff 900`, not a UUID path.
- **Drum patterns get the Humdrum grid treatment**: one lane per line, fixed lane order
  (BeatLab's own `DRUM_LANES` order), all five lanes always emitted — so toggling any step is
  always a one-line diff and never inserts/deletes lines.
- **Editors save by atomic rename** (vim, and most others) — watching the file's inode breaks on
  the first save. Watch the directory, filter by filename.

## Format v0.2 — drum tracks (closes the source-of-truth gap)

Grammar additions, keeping every v0.1 rule intact:

```
track <id> <name> <color> <kind: synth|drums>     # kind token now required (5 tokens)
  synth
    ...same 9 params (drum tracks have them too — they're the real bus/voice params)...
  pattern <lane: kick|snare|clap|hat|openhat> <vel vel vel ...>   # drums only, 16-step cycle
  note <id> <pitch> <start> <dur> <vel>                           # synth only
```

Canonical form: `kind` always emitted (one way to write a fact — the Humdrum rule, no
default-value elision); pattern lines in `DRUM_LANES` order, all lanes present, velocities
`formatNumber`-formatted. `format_version` bumps to `0.2`. The converter stops dropping drum
tracks; `droppedTracks` should now be `[]` for the real fixture, and `selectedTrackFellBack`
should be obsolete for it too.

Known accepted limitation (documented, not hidden): track names remain single tokens.

## The pieces

| # | What | Where |
|---|---|---|
| 1.1 ✅ | Format v0.2: kind token + pattern lines — parser, serializer, round-trip + rejection tests | `src/core/*`, `test/roundtrip.test.ts`, `docs/format-spec.md` |
| 1.2 ✅ | Converter v0.2: drums survive both directions; fixture tests assert zero dropped tracks | `src/core/convert.ts`, `test/convert.test.ts` |
| 1.3 ✅ | Daemon: owns the `.beat` file, serves `GET /doc`, `GET /events` (SSE), `POST /state`; write-only-if-changed + echo suppression by canonical-text comparison; dir-watch with debounce; parse errors broadcast as events, never crash the daemon (a half-saved file mid-edit is normal, not exceptional) | `src/daemon/daemon.ts`, `cli/daemon.mjs`, `test/daemon.test.ts` |
| 1.4 ✅ | BeatLab bridge: dev-only (`import.meta.env.DEV` + `?daw=<port>`), transport-only module; ALL reconciliation logic lives in the store's new `applyDawState` action (merge synth onto existing/`DEFAULT_SYNTH`, create/delete tracks, file order wins), **without** stopping playback or clearing undo (hot reload, not restore); store subscription (same gating as the autosave) POSTs state to the daemon, debounced, order-preserving, suppressed while applying | `beatlab/src/state/dawBridge.ts`, `beatlab/src/state/store.ts` (`applyDawState`) |
| 1.5 ✅ | Render CLI drops its overlay hack and calls the same `applyDawState` — new tracks and drum tracks now render; the "tracks must already exist" limitation dies | `cli/render.mjs` |
| 1.6 ✅ | End-to-end verification with **measured latency**: GUI edit → file contains it (assert the diff is exactly one line, record ms); file edit → GUI state reflects it (record ms); brand-new track added to the file → appears in the GUI; drum step toggled in the file → pattern updates; quiescence check for echo loops | `scripts/verify-m1.mjs` |

Zero new runtime dependencies: the daemon is plain `node:http` + SSE (built-in, auto-reconnecting)
rather than adding a WebSocket package. Right-sized for a localhost, single-user dev daemon.

## Exit criteria (ROADMAP M1, verbatim, plus the numbers) — ALL MET

- [x] Edit a note/knob in the GUI → `git diff` on `song.beat` shows a one-line change.
      **Verified against real git**: `git diff --numstat` = `1 1 song.beat`, the diff is exactly
      `-    cutoff 3200` / `+    cutoff 777`.
- [x] Edit the file in an editor → the GUI updates without a reload; playback keeps running.
      Playback explicitly asserted uninterrupted through the hot reload.
- [x] A track that exists only in the file appears in the GUI (file is the root document) —
      including full reconstitution: a 9-field `.beat` synth patch became a complete 74-field
      live `SynthParams` (merged onto `DEFAULT_SYNTH` by the importing side, per the converter
      contract). A drum-step toggle in the file lands in the GUI pattern too.
- [x] Both directions measured (see Result).

## Explicitly deferred past Phase 1

Clips/scenes/automation/swing/arrangement in `.beat` (they survive app-side across syncs, but
aren't in the file yet); multi-device chains; `beat inspect`/`set`/`diff` subcommands (M2);
daemon-serves-the-UI (it syncs with the existing vite dev server for now); conflict handling
beyond last-writer-wins (single local user, single daemon — git is the real concurrency story).

## Sequencing

1.1 → 1.2 (format first — everything else consumes it) → 1.3 and 1.4 (independent, meet at the
protocol) → 1.5 (needs 1.4's apply entry point) → 1.6 (needs all).

## Result

All six pieces shipped and verified in one pass (`scripts/verify-m1.mjs`, run for real against
the full stack: daemon + vite dev server + headless Chromium + a real git repo around the file).
36 unit tests green (`npm test`), BeatLab's own engine smoke suite still 14/14 after the store
changes.

**The measured latencies — the number M3 was waiting on:**

| Direction | Measured | Of which deliberate debounce |
|---|---|---|
| GUI knob-turn → file written | **262 ms** | 250 ms (bridge) |
| file edit → GUI applied | **117 ms** | 60 ms (daemon watcher) |

The real sync cost is ~10–60 ms per direction; nearly the entire wall-clock is tunable debounce.
**First opinion for M3:** file-edit→applied at ~117 ms means an agent's edit→render loop will be
dominated by the render itself (currently real-time capture, i.e. seconds), not by sync — the
daemon is not the bottleneck, and the M2 render-speed work (`node-web-audio-api` offline render)
is where the loop-time budget actually lives.

Worth carrying forward:

1. **Canonical serialization really was the sync mechanism.** Echo suppression, no-op detection,
   and "should I write?" were all plain string comparisons — zero sync bugs surfaced in the
   verification run, and the quiescence check (nothing rewrites the file after 1.5 s idle)
   passed first try. D4 keeps paying rent.
2. **Two bugs found only by running, again** (the Phase 0 lesson repeating): (a) Playwright's
   `networkidle` never fires when an SSE stream is open — the page load waited forever until
   switched to `load`; (b) the daemon's in-memory doc initially kept the POSTing client's note
   order while the file had canonical order — memory and disk disagreed until the daemon was
   made to re-parse its own canonical text after every write (`getDoc() === parse(file)` is now
   an asserted invariant).
3. **One apply path, two consumers, as designed.** The store's `applyDawState` serves both the
   daemon bridge and the render CLI; the render CLI's Phase 0 "tracks must already exist"
   limitation died as a side effect, not as separate work — the openDAW typed-boundary lesson
   doing exactly what the research said it would.

Next: `ROADMAP.md` M2 — `beat inspect`/`set`/`diff` subcommands and the faster offline render
path (`node-web-audio-api`, recipe already verified in `docs/opendaw-notes.md` §9), validated
against the headless-Chromium reference renderer per D5.

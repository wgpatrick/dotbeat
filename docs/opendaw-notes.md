# Source archaeology: openDAW, DAWproject, automix-toolkit, node-web-audio-api

> Unlike `docs/research/`, this document comes from **reading actual source code**, not web
> search — a Claude agent shallow-cloned these repos and read specific files directly. Citations
> below are real file paths, not URLs to summaries.

> **⚠️ License note before copying anything:** openDAW is **AGPL v3 / LGPL-3.0-or-later**.
> Vocabulary, field names, schema shapes, and architectural patterns are free to reuse (facts and
> ideas aren't copyrightable). **Verbatim code is not** — porting substantial original openDAW
> source into a differently-licensed project risks AGPL copyleft obligations. Treat everything
> below as "read and reimplement," never "copy-paste."

> **Cross-validated against web research**: two independent, fully-verified web-research passes
> (`docs/research/01-landscape.md`, `docs/research/02-web-stack-feasibility.md`) both had
> single-source claims that openDAW "ships a headless SDK" with specific 2026-roadmap dates —
> and **both of those claims were independently refuted on adversarial verification**, which
> matches exactly what direct source reading found here (§3): no separate SDK package exists;
> headless capability is an internal test/perf harness. Web search and source reading converging
> on the same correction is a good sign both are trustworthy where they agree.

## Sources read

- `openDAW` — github.com/andremichelle/openDAW (shallow clone, AGPL v3/LGPL)
- `dawproject` — github.com/bitwig/dawproject (shallow clone, MIT — `Project.xsd`, `MetaData.xsd`
  read in full, 843 + 24 lines)
- `automix-toolkit` — github.com/csteinmetz1/automix-toolkit (shallow clone, Apache-2.0)
- `node-web-audio-api` — `examples/tone.js` fetched directly

No separate `opendaw-headless` repo exists (404) — headless capability lives inside the openDAW
monorepo as an internal test/perf harness, not a shipped CLI. Correction to the earlier
web-research claim that it's a published SDK.

---

## 1. openDAW's data model: a typed graph, not a plain object tree

The core model (`packages/lib/box/`, `@opendaw/lib-box`, zero DOM/React deps) is a **graph
database**: every track/clip/note/device is a `Box` — a UUID-addressed node with numbered
`Field`s, connected via typed, bidirectionally-validated **pointer fields** (not ad-hoc nesting).
Deleting a box cascades through its dependency graph automatically.

Box types are **declaratively schema'd**, then codegen'd into both TypeScript classes *and Rust
structs* — one schema, two language targets, so the WASM engine never hand-duplicates types.

Real field vocabulary worth reusing directly (facts, not code):

```
NoteEventBox:   position(ppqn) duration(ppqn) pitch(0-127) velocity(0-1)
                play-count play-curve cent(±50, micro-tuning) chance(0-100, probabilistic trigger)

AudioUnitBox:   type(Instrument/Bus/Aux/Output) volume(dB,-96..6,"decibel" scaling)
                panning(bipolar) mute solo + pointer-collections: tracks, midi-effects,
                input(exclusive), audio-effects, aux-sends, output

CompressorDeviceBox:
                lookahead automakeup autoattack autorelease
                inputgain(dB,-30..30,linear) threshold(dB,-60..0,linear)
                ratio(1-24,exponential) knee(dB,0-24,linear)
                attack(ms,0-100,linear) release(ms,5-1500,linear)
                makeup(dB,-40..40,linear) mix(0-1,unipolar,%) side-chain(pointer,optional)
```

**Pattern worth copying:** parameter metadata (`{value, min, max, mid, unit, scaling}`) lives
*in the schema*, feeding both the data model and the UI knob — one source of truth, not
duplicated in component code. A `scaling: "linear"|"decibel"|"exponential"` field even declares
the knob's response curve declaratively.

**A field being automatable is a schema-level fact** (`pointerRules: ParameterPointerRules`), not
scattered UI logic. Copy this idea.

## 2. Engine/UI separation — real, enforced at the package level

Not just "the engine doesn't import React" (too weak). openDAW enforces it two ways:

1. **Package dependency graph:** `studio-adapters` (the reactive layer both engine and UI
   consume) and `studio-core-processors` (the actual DSP engine, `EngineProcessor extends
   AudioWorkletProcessor`) both have **zero React/DOM package dependencies** — checked their
   `package.json`s directly.
2. **Runtime process boundary:** even inside the browser, UI (main thread) and engine
   (AudioWorklet) are separate execution contexts that **only communicate via a typed RPC
   `Communicator`/`Messenger` layer** over `MessagePort`. They never share objects.

**This is why headless testing is nearly free** — the test harness just swaps a same-process
`MessageChannel` for the real worklet port, and the engine class doesn't know the difference.
**Directly informs our own architecture** (`docs/architecture.md`'s `core`/`engine`/`ui`/`daemon`
split) — the lesson is: make the boundary a *published, typed interface*, not a convention.

## 3. Headless rendering — the actual recipe

No `dev:headless` script exists; the pattern lives in `packages/app/wasm/test/helpers/render-ts.ts`
and its production twin `offline-render.ts` / `OfflineEngineRenderer`. Verbatim recipe (reimplement,
don't copy):

1. Install a **worklet-globals shim** (`worklet-env.ts`) that fakes `AudioWorkletProcessor`/
   `sampleRate` so the engine class instantiates outside a real browser AudioWorklet.
2. Wire an RPC pair over `node:worker_threads`' `MessageChannel` — same contract the real
   browser main-thread/worklet boundary uses.
3. Construct the engine directly from **raw serialized project bytes** — no disk, no UI, no OPFS.
4. Drive `processor.process()` per audio quantum (128 frames) in a plain loop — no realtime
   clock, no `AudioContext`.

**Confirms:** a project can be built/mutated/rendered fully headless with only a small
browser-API shim, not a browser. This is the shape our `beat render` CLI command should take.

## 4. ID scheme

- Random 128-bit UUID per entity (not spec-compliant UUIDv4, just random bytes).
- Fields within a box are addressed as `<uuid>/1/3/2` (numeric field-key path) — this composite
  address is the unit for automation targets, undo-log entries, *and* network sync deltas.
- **Content-addressable exception:** audio assets get a SHA-256-derived UUID, so identical file
  content dedupes automatically. Directly matches our own `docs/format-spec.md` content-addressed
  media plan — validates that design.
- Explicit copy/paste ID policy per box type: `preserved` (keep UUID — content-addressable data),
  `internal` (regenerate — private per-owner data), `shared` (regenerate, don't follow edges).
  **Worth copying** for our own clipboard/duplicate-track logic.

## 5. The project bundle format — and why we should NOT copy it

`.odb` = a JSZip containing `project.od` (the box graph, in a **custom binary format**: magic
header + numeric field keys + length-prefixed bytes) + `meta.json` + sample/soundfont folders.

**Crucially: no design doc anywhere justifies zip-over-text.** The one rationale found is a code
comment: the binary format is a "WASM CONTRACT" so Rust and TypeScript engines can byte-checksum
each other — a cross-language-parity requirement that doesn't apply to us. **Diff-friendliness
was never a design goal for openDAW's format.** Even its own `toJSON()` escape hatch serializes
*numeric* field keys (`{"1": ..., "20": true}`), not names — confirming the human-readable path
was never really exercised.

**This is the clearest single validation of our own direction**: the closest prior art
deliberately chose an opaque format for reasons that don't apply to us, and its own "readable"
fallback still isn't actually readable. Nothing here should be copied structurally — only the
*lesson* that diff-friendliness has to be designed for on purpose, because it doesn't fall out of
"eh, it's JSON-ish."

## 6. DAWproject — real schema vocabulary, worth borrowing verbatim (MIT-licensed, safe to copy)

Read the full `Project.xsd` (843 lines). Concrete, reusable element/attribute names:

- **Parameter family:** `realParameter`(min,max,unit,value) / `boolParameter` /
  `integerParameter` / `enumParameter`(count,labels,value). `unit` enum:
  `linear|normalized|percent|decibel|hertz|semitones|seconds|beats|bpm`.
- **Compressor:** `Attack, AutoMakeup, InputGain, OutputGain, Ratio, Release, Threshold`.
- **EQ:** `Band`(repeatable) → `Freq, Gain, Q, Enabled, type(highPass|lowPass|bandPass|highShelf|
  lowShelf|bell|notch), order`.
- **Limiter / noise gate:** `Attack, InputGain, OutputGain, Release, Threshold` (+`Range` for gate).
- **Clips:** `time, duration, contentTimeUnit, playStart, playStop, loopStart, loopEnd,
  fadeInTime, fadeOutTime`.
- **Automation points:** `Points/RealPoint/EnumPoint/BoolPoint` — each a `time` + typed `value` +
  `interpolation`(hold|linear).
- **Automation targets:** reference a `parameter` OR an `expression` enum
  (`gain|pan|transpose|timbre|formant|pressure|pitchBend|...`) — real MPE/expression vocabulary
  worth having even before we support full MPE.
- Uses `xs:ID`/`xs:IDREF` (human-assignable string IDs) for cross-references — **exactly the
  "human slug, not UUID" approach we already leaned toward** in `docs/decisions.md` D4.

openDAW's own `DawProjectExporter.ts` is a working example of translating a box-graph model into
this schema (dB↔gain conversion, bipolar↔normalized pan conversion) — worth reading in full if we
build DAWproject import/export later. It also uses a neat trick: an `AddressIdEncoder` that turns
internal UUIDs into short sequential IDs (`id1`, `id2`...) purely for XML output — validates our
own "keep UUID canonical, mint a short slug at the text boundary" idea.

## 7. Undo system — steal this whole pattern

Not snapshot-based — an **inverse-update-log**. Every transaction captures its `Update[]`
(add/delete/field-change), optimized and stored as a `Modification` object with `.forward()` and
`.inverse()`. Multiple `modify()` calls can merge into one undo step. Robustness details worth
copying: mid-replay failure rolls back partial application; a save-point index handles the "you
undid past your last save" edge case explicitly.

**Directly useful beyond undo:** a `Modification` *is* a computed diff. This is a strong candidate
data structure for our own `beat diff` / `--dry-run` preview — we may not need to invent a
separate diff representation if we adopt this shape.

## 8. automix-toolkit — scope correction

The actual Differentiable Mixing Console (`automix/models/dmc.py`) predicts **only 2 parameters
per stem: gain and pan** (proper equal-power pan, not linear). No EQ/compressor model exists in
the repo despite broader README ambitions. **Correction to `ROADMAP.md` §7**: don't assume
published differentiable-mixing prior art gives us EQ/comp-aware critique — the real baseline is
loudness balance + stereo placement. EQ/comp-aware auto-mix, if we want it, is past the frontier
of what's been demonstrated, not something to borrow wholesale.

## 9. node-web-audio-api + Tone.js — the exact incantation

```js
import '#node-web-audio-api-polyfill';   // must be first — patches globalThis
import * as Tone from 'tone';

const audioContext = new window.AudioContext();  // from the polyfilled global
Tone.setContext(audioContext);                    // before creating any Tone nodes
// ... build the graph, drive Tone.getTransport() ...
process.exit(0);   // Tone.js has no clean Node teardown — plan for this in the CLI
```

Confirms headless Tone.js in Node is solved, if slightly hacky (no graceful shutdown — the CLI
needs an explicit exit/timeout, not a wait-for-idle).

---

## What changes in our plan

1. **Format decision reinforced, not questioned.** openDAW — the closest prior art — chose an
   opaque bundle for a reason specific to *their* cross-language parity needs, not because
   diff-friendly text is hard. Nothing here argues against our document-only, diff-friendly text
   direction; if anything it's the strongest evidence yet that nobody has actually tried.
2. **Adopt the graph/pointer-field mental model**, not a plain nested object tree, for `core`'s
   in-memory representation — even though the *serialized* form stays flat readable text. Typed,
   validated references + cascade delete are worth having internally.
3. **Steal DAWproject's parameter vocabulary wholesale** (it's MIT) for `.beat` device schemas —
   no reason to invent our own compressor/EQ field names when a cross-DAW-agreed set exists.
4. **Adopt the inverse-update-log as both undo AND our diff representation** — one data structure,
   two uses.
5. **Correct the AI-critique scope** — automix-toolkit's real baseline is gain+pan, not full
   EQ/comp. Update `ROADMAP.md` §7 language accordingly (see roadmap edit).
6. **Human slugs over raw UUIDs at the text-serialization boundary** — DAWproject's `xs:ID` and
   openDAW's own `AddressIdEncoder` escape hatch both independently arrive at "short human-legible
   IDs for the text/XML surface, UUID or content-hash underneath." Validates `docs/decisions.md`
   D4 rather than changing it.

See `ROADMAP.md` and `docs/decisions.md` (D6, new) for how this folds into the live plan.

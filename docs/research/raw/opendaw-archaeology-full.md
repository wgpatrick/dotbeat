# openDAW (and prior-art) source archaeology — findings for dotbeat

Sources read directly (shallow clones, read-only):
- `/tmp/research-clones/openDAW` — https://github.com/andremichelle/openDAW (main branch, current as of clone date)
- `/tmp/research-clones/dawproject` — https://github.com/bitwig/dawproject
- `/tmp/research-clones/automix-toolkit` — https://github.com/csteinmetz1/automix-toolkit
- node-web-audio-api example fetched directly (not cloned): `examples/tone.js` from https://github.com/ircam-ismm/node-web-audio-api

No separate `opendaw-headless` repo exists (404 on `api.github.com/repos/andremichelle/opendaw-headless`). Headless capability lives entirely inside the main monorepo (see §3). openDAW is a Turborepo/npm-workspaces monorepo with `packages/lib/*` (engine-agnostic libraries), `packages/studio/*` (DAW-specific core/engine/adapters/schema), and `packages/app/*` (React UI, WASM test harness, etc). AGPL v3 / LGPL-3.0-or-later licensed — note for any code you port verbatim.

---

## 1. Project/document model

The core data model is **not a plain object tree** — it's a graph database called "Box Graph", in `packages/lib/box/` (`@opendaw/lib-box`, engine-agnostic, zero DOM/React deps). Key files:
- `packages/lib/box/src/box.ts` — `Box` abstract class: a graph node with a UUID address, a set of numbered `Field`s, pointer rules, and a `resource` marker.
- `packages/lib/box/src/field.ts`, `primitive.ts`, `array.ts`, `object.ts`, `pointer.ts` — field type system (primitives, arrays, nested objects, and **pointer fields** which are typed graph edges).
- `packages/lib/box/src/graph.ts` — `BoxGraph`: owns all boxes, transaction lifecycle, edge tracking.
- `packages/lib/box/src/address.ts` — `Address` = `UUID.Bytes` + a path of numeric `FieldKey`s (int16 array), i.e. every field in the graph is addressable as `uuid/1/3/2...`. This address is also the unit of undo-log entries and of live-update/network-sync messages.
- `packages/lib/box/src/vertex.ts` — `Vertex` interface (visitor pattern for typed field traversal).

Concretely: a track, a region, a note, a device are all `Box` subclasses generated from declarative schemas (see §1a). Boxes reference each other only through typed **pointer fields** validated at both ends by `pointerRules: {accepts: [...], mandatory, exclusive}` — this is essentially a strongly-typed, bidirectionally-validated graph edge system, not just embedding/nesting. E.g. `TrackBox.regions` accepts `Pointers.RegionCollection`; a `NoteRegionBox` has a mandatory pointer back to `regions`. Deleting a box cascades through `graph.dependenciesOf()` (outgoing pointers + mandatory incoming pointers), see `packages/lib/box/src/box.ts:185-196` and is documented in `packages/lib/box/README.md` and `docs/graph.md`.

### 1a. Schema definition (declarative, codegen'd)

Box types are NOT hand-written classes; they're declarative schema objects in `packages/studio/forge-boxes/src/schema/std/**/*.ts`, compiled by `packages/lib/box-forge` (`@opendaw/lib-box-forge`, see `ts-class-writer.ts`, `rust-registry.ts`, `forge.ts`) into both TypeScript classes (in the generated `packages/studio/boxes` package — source not checked into git, it's a build artifact) **and Rust structs** (`crates/`, for the WASM engine). One schema, two codegen targets — worth copying as a pattern if you want a fast Rust/WASM path later without hand-duplicating the type system.

Example schema (`packages/studio/forge-boxes/src/schema/std/timeline/TrackBox.ts`, full file):
```ts
export const TrackBox: BoxSchema<Pointers> = {
    type: "box",
    class: {
        name: "TrackBox",
        fields: {
            1: {type: "pointer", name: "tracks", pointerType: Pointers.TrackCollection, mandatory: true},
            2: {type: "pointer", name: "target", pointerType: Pointers.Automation, mandatory: true},
            3: {type: "field", name: "regions", pointerRules: {accepts: [Pointers.RegionCollection], mandatory: false}},
            4: {type: "field", name: "clips", pointerRules: {accepts: [Pointers.ClipCollection], mandatory: false}},
            10: {type: "int32", name: "index", ...IndexConstraints},
            11: {type: "int32", name: "type", constraints: {values: [0, 1, 2, 3]}, unit: ""}, // TrackType
            20: {type: "boolean", name: "enabled", value: true},
            30: {type: "boolean", name: "exclude-piano-mode", value: false}
        }
    }, pointerRules: {accepts: [Pointers.Selection, Pointers.PianoMode, Pointers.MetaData], mandatory: false}
}
```

`NoteEventBox` (a single MIDI note, `packages/studio/forge-boxes/src/schema/std/timeline/NoteEventBox.ts`) — concrete field vocabulary worth reusing:
```
position (int32, ppqn), duration (int32, ppqn, default PPQN.SemiQuaver),
pitch (int32, MIDI 0-127, default 60), velocity (float32, 0..1, default 100/127),
play-count (int32, 1..128, "for repeats"), play-curve (float32, -1..1),
cent (float32, -50..50, unit "ct" — micro-tuning), chance (int32, 0..100, unit "" — probabilistic trigger)
```
`NoteRegionBox`: `position, duration, loop-offset, loop-duration, event-offset, mute, label, hue` (hue = int32 color for UI, stored in the *document*, not just UI state — a pattern worth noting: cosmetic-but-project-scoped fields live in the same box as structural fields).

`AudioUnitBox` (= a mixer channel / instrument track, `packages/studio/forge-boxes/src/schema/std/AudioUnitBox.ts`) has fields: `type` (Instrument/Bus/Aux/Output), `volume` (dB, min -96/mid -9/max 6, `scaling: "decibel"`), `panning` (bipolar), `mute`, `solo`, and separate pointer-collections for `tracks`, `midi-effects`, `input` (exclusive — one instrument), `audio-effects`, `aux-sends`, `output`. Every automatable field carries `pointerRules: ParameterPointerRules` — that's how a field becomes a valid automation-lane target (see §1b).

`CompressorDeviceBox` (`packages/studio/forge-boxes/src/schema/devices/audio-effects/CompressorDeviceBox.ts`) is a clean example of a full effect parameter schema — good field-name/range vocabulary to borrow:
```
lookahead (bool), automakeup (bool), autoattack (bool), autorelease (bool),
inputgain (dB, -30..30, linear), threshold (dB, -60..0, linear),
ratio (1..24, exponential scaling), knee (dB, 0..24, linear),
attack (ms, 0..100, linear), release (ms, 5..1500, linear),
makeup (dB, -40..40, linear), mix (0..1, "unipolar", unit "%"),
side-chain (pointer, optional)
```
Note the `scaling: "linear"|"decibel"|"exponential"` field on constraints — a declared curve for UI knobs/sliders bound to the same schema. Worth copying: parameter metadata (min/mid/max/unit/scaling) lives in the schema, not scattered in UI code.

### 1b. Automation targeting
Any field with `pointerRules: ParameterPointerRules` can have an `AutomationBox`/track point at it via `Pointers.Automation`. This means automation doesn't reference "track 3, param 'volume'" by string path — it holds a **typed pointer field to the actual Field object's address**. This is elegant for engine dereferencing but means automation targets are UUID+fieldpath, not human labels (relevant to your diff-friendliness goal — see "do differently" below).

### 1c. Is there a clean serialization boundary?
Yes and no. `Box.write()/read()` serialize to a **custom binary format** (see §5) via `Serializer.writeFields`/`readFields` (`packages/lib/box/src/serializer.ts`) — NOT JSON, despite `Box` also implementing `toJSON()/fromJSON()` (`packages/lib/box/src/box.ts:138-158`). The JSON path exists but keys fields by **raw numeric FieldKey**, not by name (`Object.entries(this.#fields)` where `#fields` is keyed by the schema's numeric keys) — so even the JSON path is not human/diff friendly out of the box; it'd render as `{"1": ..., "10": ..., "20": true}` rather than `{"tracks": ..., "index": ..., "enabled": true}`.

---

## 2. Engine/UI separation

This is real and enforced at the **package dependency level**, not just by convention:

- `@opendaw/lib-box`, `@opendaw/lib-std`, `@opendaw/lib-dsp` — zero DOM/React/browser deps.
- `@opendaw/studio-adapters` (`packages/studio/adapters`) — the reactive layer between the raw box graph and consumers (both UI and engine use it). Its `package.json` depends only on `lib-box`, `lib-dsp`, `lib-fusion`, `lib-midi`, `lib-runtime`, `lib-std`, `studio-boxes`, `studio-enums`, `soundfont2` — **no React, no DOM**. This is the `BoxAdapters` pattern: typed adapter objects (`TrackBoxAdapter`, `AudioUnitBoxAdapter`, `RootBoxAdapter`, etc.) wrap raw boxes with derived/observable state, consumed identically by the engine and by React components.
- `@opendaw/studio-core-processors` (`packages/studio/core-processors`) — the actual DSP engine. `EngineProcessor` (`packages/studio/core-processors/src/EngineProcessor.ts`) `extends AudioWorkletProcessor` but its package deps are only `lib-box, lib-dsp, lib-runtime, lib-std, studio-adapters, studio-boxes, studio-enums` — again no React/DOM package dependency; `AudioWorkletProcessor` itself is stubbed out for Node via a shim (`worklet-env.ts`, see §3) so the whole engine can run outside a browser.
- The React app (`packages/app/studio`) talks to the engine only through a message-passing `Communicator`/`Messenger` RPC layer (`@opendaw/lib-runtime`) over a `MessagePort`/`SharedArrayBuffer`/`SyncStream` — i.e. even *within the browser*, UI and engine are two separate execution contexts (main thread vs AudioWorklet) that never share objects directly, only serialized commands/updates. This message-passing boundary is exactly why the engine is trivially headless-testable: the test harness just swaps a same-process `MessageChannel` for the real worklet port.

**Takeaway pattern**: separation isn't "the engine doesn't import React" (too weak) — it's "the engine and the UI are different processes/threads that only communicate over a typed RPC boundary, and that boundary is package-published on its own (`studio-adapters`) so both sides consume the same types."

---

## 3. Headless mode (no `dev:headless` script — it's an internal testing pattern, not a shipped CLI)

There is **no** `npm run dev:headless` command in the current repo (checked `package.json` root scripts: `dev:studio`, `dev:lab`, `dev:nam-test`, `dev:yjs-server`, `test`, `lint`, `build`). Headless operation instead exists as a well-developed **internal test/perf harness** used by ~100 vitest files in `packages/app/wasm/test/*.test.ts` plus `packages/app/wasm/src/perf/offline-render.ts`. This is arguably *more* useful for you than a dev script would be, because it's exactly the code path a CLI render command would use.

Concrete entry point: `packages/app/wasm/test/helpers/render-ts.ts` (`renderTs`) and its non-test twin `packages/app/wasm/src/perf/offline-render.ts` (`renderTsOffline`). Recipe, verbatim pattern:
1. `setupWorkletGlobals({sampleRate})` — a shim (`packages/studio/core-workers/src/worklet-env.ts`) that installs fake `AudioWorkletProcessor`/`sampleRate` globals so the engine class can be instantiated outside a real AudioWorklet.
2. `const {MessageChannel} = await import("node:worker_threads")` then wire a `Messenger`/`Communicator` RPC pair over the two `MessagePort`s (same RPC contract the browser main-thread/worklet boundary uses — see §2). One side implements `EngineToClient` (stub out logging, feed `fetchAudio`/`fetchSoundfont` from an in-memory `Map`), the other calls `EngineCommands` (play/stop/setPosition/etc).
3. `const {EngineProcessor} = await import(".../EngineProcessor")` — dynamic import *after* the worklet globals exist, because the class extends the shimmed global.
4. `new EngineProcessor({processorOptions: {syncStreamBuffer, controlFlagsBuffer, hrClockBuffer, project, exportConfiguration}})` — `project` is the raw serialized box graph bytes (a `ProjectSkeleton`), so you can boot the engine directly from bytes without ever touching disk/UI/OPFS.
5. Poll `engineCommands.queryLoadingComplete()`, then `engineCommands.play()`, then call `processor.process([[]], outputs)` per audio quantum (128 frames = `RenderQuantum`) in a plain `for` loop — this **is** the render loop, driven synchronously, no realtime clock, no AudioContext at all.

This confirms: **you can build/mutate/render a project fully headless** — box graph mutation via `BoxEditing.modify()` (§7) works identically headless or not (it's just graph operations); rendering audio needs only the `EngineProcessor` + the worklet-globals shim, no browser APIs. The production non-test offline renderer used for real exports is `OfflineEngineRenderer` (referenced from `packages/app/studio/src/service/StudioService.ts:617` — `const {OfflineEngineRenderer} = await import("@opendaw/studio-core")`), which is the same idea productionized (used for WAV/stem export inside the actual app, run off the main thread).

There's also a parallel **WASM engine path** (`renderWasmOffline` in the same `offline-render.ts`) that links a Rust-compiled engine module directly via `WebAssembly.Instance` and drives it with `engine.render()` — openDAW maintains **two engines (TS and Rust/WASM) with byte-identical behavior**, verified by dozens of "X-ts-vs-wasm" parity tests (e.g. `packages/app/wasm/test/reverb-device.test.ts`, `apparat-parity.test.ts`). Not directly relevant to your MVP, but the parity-testing discipline (checksums via `SyncSource.checksum()`/`BoxIO` sync protocol, see `packages/lib/box/src/sync*.ts`) is a pattern worth studying later if you ever add a native/WASM fast path.

---

## 4. ID scheme

- Every `Box` has a **random 128-bit UUID** (`packages/lib/std/src/uuid.ts:15`: `UUID.generate = () => crypto.getRandomValues(new Uint8Array(16))`), formatted as standard `8-4-4-4-12` hex (`UUID.validateString` regex). Not a UUIDv4 spec-compliant generator (no version/variant bits forced) but effectively a random 128-bit ID.
- Every **field within a box** is additionally addressable via `Address` = `[UUID.Bytes, Int16Array of FieldKeys]`, serialized/stringified as `"<uuid>/1/3/2"` (`packages/lib/box/src/address.ts:119`). This composite address is the unit used for automation targets, undo-log entries, and network sync deltas.
- **Content-addressable exception**: `packages/lib/std/src/uuid.ts:17` has `UUID.sha256()` which hashes a buffer (first 16 bytes of SHA-256) — used to derive stable IDs for **audio file assets** so identical file content dedupes automatically. This pairs with the `resource: "preserved" | "internal" | "shared"` marker on a `Box` schema (`packages/lib/box/src/box.ts:38-42`): `"preserved"` = UUID kept across copy/paste (content-addressable data like audio files), `"internal"` = UUID regenerated on copy (private per-owner data), `"shared"` = UUID regenerated and incoming edges NOT followed (independent shared data). This copy/paste UUID-remapping design (documented in `packages/lib/box/README.md` under "Resource Boxes" / "Dependency Collection") is a genuinely useful pattern for your own clipboard/duplicate-track logic.
- Numeric `FieldKey`s (not string names) are the wire/schema identifier for a field — the human name (`"volume"`, `"threshold"`) exists only in the TS schema, not in the serialized bytes or in `toJSON()` output. **This is the single biggest thing to do differently for diff-friendliness** — see below.

---

## 5. Project bundle format ("openDAW project bundle", extension `.odb`)

Confirmed at `packages/app/wasm/src/bundle.ts` (full file, has a good doc comment) and `packages/lib/box/src/serializer.ts`. It's a **JSZip archive** (`import("jszip")`, `zip.loadAsync`) containing:
```
version           — plain text, currently "1"
uuid              — 16 raw bytes, the project's own id (optional)
project.od        — the box graph, in a CUSTOM BINARY FORMAT (see below), NOT JSON
meta.json         — actual JSON (arbitrary metadata blob, engine ignores it)
samples/<uuid>/audio.wav      (+ peaks/meta files the engine ignores)
soundfonts/<uuid>/soundfont.sf2
```
`project.od`'s binary format (`packages/lib/box/src/serializer.ts`, full file — 37 lines):
- Magic header `0x464C4453` ("FLDS" in ASCII) per box, per field-group.
- `writeShort(fieldCount)`, then per field: `writeShort(numericFieldKey)`, `writeInt(byteLength)`, raw bytes.
- Comment in the source explicitly says: **"WASM CONTRACT: this FLDS magic and the writeFields layout ... are parsed and checksummed byte-for-byte by Rust (crates/boxgraph)"** — i.e. the binary format is deliberately shared/mirrored between the TS and Rust engines for the parity-testing described in §3. This is presumably *why* they didn't use JSON/text for the main document: cross-language byte-identical parsing + checksumming was a design requirement for keeping two engines in sync, not (as far as I could find) a deliberate "let's avoid text" decision.
- **I found no design doc, issue, or comment explicitly justifying zip-over-plain-text.** Checked `announcements/DECISIONS.txt` (only covers announcement writing style, not architecture), `docs/*.md` (`graph.md`, `performance.md`, `live-collab-*.md`, `overlapping-regions-behaviour.md`, `monaco-clipboard-fix.md` — none discuss file format tradeoffs), `future-plans/*.md`. The closest thing to a rationale is the WASM-contract comment above: byte-for-byte binary parity across TS/Rust was the actual driver, diff-friendliness/human-readability was apparently never a goal.
- Box's own `toJSON()` exists (§1c) but is unused for the main project file; it's presumably for debugging or clipboard (grep found no clipboard code actually calling `Box.toJSON`; clipboard handlers in `packages/studio/core/src/ui/clipboard/types/*.ts` instead do box-graph-level copy via `BoxGraphCopy`/`dependenciesOf`, i.e. structural copy, not a JSON round-trip).

---

## 6. Device/plugin architecture

Devices are just more `Box` schema types, split into `packages/studio/forge-boxes/src/schema/devices/{audio-effects,midi-effects,instruments}/*.ts` (inferred layout; confirmed via `CompressorDeviceBox.ts`, `ReverbDeviceBox.ts`, `DattorroReverbDeviceBox.ts` found under `devices/audio-effects/`). Common structure via `DeviceFactory.createAudioEffect(name, fields)` helper (`packages/studio/forge-boxes/src/std/DeviceFactory.ts`, referenced not fully read) which presumably injects standard device fields (enabled, bypass, chain position) before the effect-specific ones. Every automatable param uses the shared `ParameterPointerRules` pointer-rule object (`packages/studio/forge-boxes/src/schema/std/Defaults.ts`) so any device parameter is automation-targetable identically. Devices are hosted in ordered pointer-collections off `AudioUnitBox` (`audio-effects`, `midi-effects`, `input` for the instrument slot) — chain order is the collection order, not a separate index field for most fields (though some have an explicit `index` field, e.g. `AuxSendBox`).

The **DAWproject exporter** (`packages/studio/core/src/dawproject/DawProjectExporter.ts`, full file read, ~373 lines) is a strong existing bridge between openDAW's internal device vocabulary and DAWproject's — e.g. it maps `AudioUnitBox.volume` (dB) → DAWproject `ParameterEncoder.linear(id, dbToGain(volume), 0.0, 2.0, "Volume")`, `panning` (bipolar -1..1) → DAWproject normalized 0..1 pan, and packs each device's opaque state via `DeviceIO.exportDevice(box)` into a `presets/<uuid>` resource file referenced by `BuiltinDeviceSchema.state`. Notably, device parameters are NOT individually exported to DAWproject (`automatedParameters: []` is hardcoded — a `// TODO` implicitly) — only enabled state + a serialized opaque preset blob. Real code, not vaporware: `packages/studio/core/src/dawproject/DawProjectExporter.test.ts` exists.

---

## 7. Undo/history system

Implemented in `packages/lib/box/src/editing.ts` (`BoxEditing` class, full file read, 285 lines) — **not snapshot-based, it's an inverse-update-log**:
- `BoxGraph.subscribeToAllUpdates()` captures every low-level `Update` (add/delete/field-change — see `packages/lib/box/src/updates.ts`) emitted during a transaction.
- `BoxEditing.modify(fn)` wraps `fn` in `graph.beginTransaction()/endTransaction()`, collects the resulting `Update[]`, runs `optimizeUpdates()` (presumably coalesces redundant field writes) and stores them as a `Modification` (`editing.ts:20-36`) — an object with `.forward(graph)` (replay) and `.inverse(graph)` (replay each `Update.inverse()` in reverse order).
- Undo history is `#marked: Array<ReadonlyArray<Modification>>` (a stack of grouped modifications, i.e. multiple `modify()` calls can be merged into one undo step via `append()`) with a `#historyIndex` cursor — classic linear undo/redo stack, but the "payload" per step is a list of reversible field-level ops, not a full-document snapshot. This is memory-efficient and is exactly the "operation log" pattern that would also make a good basis for your CLI's `--dry-run`/diff-preview feature (a `Modification` is basically a computed diff already).
- Robustness detail worth copying: undo/redo catches failures mid-replay (`tryCatch`) and **rolls back partial application** by replaying already-applied steps in the opposite direction, then notifies the user "History changed by another participant" (`editing.ts:97-104`) — this exists because of their Yjs-based live-collab feature (`packages/studio/core/src/ysync/`), where a remote peer's concurrent edit can invalidate a local undo step.
- Save-point tracking: `#savedHistoryIndex` (`markSaved()`/`hasUnsavedChanges()`) with a `-1` sentinel for "the saved position was spliced out of history" (i.e. you undid past your last save, then made a new edit, so you can never cleanly get back to "saved" state) — a real edge case worth handling explicitly in your own undo design.

---

## 8. Roadmap/rationale notes on file format

Nothing found beyond the WASM-parity-contract comment in §5. No GitHub issue/discussion text was fetched (blocked by proxy — `api.github.com` returned 403/errors for unauthenticated calls in this environment), but repo-local docs (`announcements/`, `docs/`, `future-plans/`, `wiki/`) contain no design discussion of zip-vs-text. `docs/graph.md` and `packages/lib/box/README.md` are the two documents that actually explain the storage/graph model in prose and were the most useful non-code sources.

---

## Secondary targets — concrete artifacts

### DAWproject (`/tmp/research-clones/dawproject`)
Full `Project.xsd` (843 lines) and `MetaData.xsd` (24 lines) read directly. No sample `.dawproject` XML found in-repo (only `test-data/white-glasses.wav`, a binary test fixture — no XML examples checked in). Key vocabulary to borrow (already exact XSD type/attribute names):
- Document root: `<Project version="1.0">` containing `Application`, `Transport`, `Structure` (choice of `Track`/`Channel`), `Arrangement`, `Scenes`.
- Parameter family: abstract `parameter` (has `parameterID` + inherited `id`/`name`/`color`/`comment`) → `realParameter` (`min`,`max`,`unit`,`value`), `boolParameter`, `integerParameter`, `enumParameter` (`count`,`labels` list,`value`), `timeSignatureParameter` (`numerator`,`denominator`). `unit` enum: `linear|normalized|percent|decibel|hertz|semitones|seconds|beats|bpm`.
- Mixer/channel: `channel` extends `lane`, has `Devices` (choice of `Device|Vst2Plugin|Vst3Plugin|ClapPlugin|BuiltinDevice|Equalizer|Compressor|NoiseGate|Limiter|AuPlugin`), `Mute`, `Pan`, `Sends` (`Send` has `destination` IDREF, `type` = `pre|post`, `Volume`), `Volume`; attributes `audioChannels`, `destination` (IDREF), `role` = `regular|master|effect|submix|vca`, `solo`.
- Built-in device parameter vocabulary (exact XSD element names, directly reusable):
  - `equalizer`: `Band` (repeatable, `eqBand` has `Freq`,`Gain`,`Q`,`Enabled`, `type`=`highPass|lowPass|bandPass|highShelf|lowShelf|bell|notch`, `order`), `InputGain`, `OutputGain`.
  - `compressor`: `Attack`, `AutoMakeup`, `InputGain`, `OutputGain`, `Ratio`, `Release`, `Threshold`.
  - `noiseGate`: `Attack`, `Range`, `Ratio`, `Release`, `Threshold`.
  - `limiter`: `Attack`, `InputGain`, `OutputGain`, `Release`, `Threshold`.
- Timeline content types: `Notes`(→`Note`: `time,duration,channel,key,vel,rel` — all `xs:string` for time-typed values to allow beats-or-seconds text encoding, `channel`/`key` are `xs:int`), `Clips`(→`Clip`: `time,duration,contentTimeUnit,playStart,playStop,loopStart,loopEnd,fadeInTime,fadeOutTime,enable,reference`), `Audio`/`Video` (extend `mediaFile`: `File` (fileReference: `path`,`external`), `duration`,`algorithm`,`channels`,`sampleRate`), `Warps`/`Warp` (`time`,`contentTime` pairs — audio time-stretch anchor points), `Points`/`RealPoint`/`EnumPoint`/`BoolPoint`/`IntegerPoint`/`TimeSignaturePoint` (automation, each point has `time` + typed `value` + optional `interpolation`=`hold|linear`), `Markers`/`Marker` (`time`,`name`).
- `automationTarget`: `parameter` (IDREF), `expression` (enum: `gain|pan|transpose|timbre|formant|pressure|channelController|channelPressure|polyPressure|pitchBend|programChange` — MPE/expression vocabulary worth having even without full MPE support), `channel`,`key`,`controller` (for raw-MIDI-CC automation targets not tied to a plugin parameter).
- Uses `xs:ID`/`xs:IDREF` throughout for cross-references (native XML referential integrity) — the XML equivalent of openDAW's UUID pointer system, but human-assignable string IDs rather than UUIDs.

openDAW's own DAWproject exporter (`packages/studio/core/src/dawproject/DawProjectExporter.ts`) is worth reading in full if you build DAWproject import/export — it's a working example of translating a box-graph model into this exact schema, including gain curve conversions (`dbToGain`), pan law conversion (bipolar -1..1 → normalized 0..1), and an `AddressIdEncoder` (`packages/lib/box/src/address.ts:153-165`) that turns UUIDs into short sequential human IDs (`id1`, `id2`, ...) purely for the XML `id`/`IDREF` attributes — a nice trick if you ever need short stable-within-a-file IDs for a text format while keeping UUIDs as the canonical internal identity.

### automix-toolkit (`/tmp/research-clones/automix-toolkit`)
The Differentiable Mixing Console (`automix/models/dmc.py`, class `Mixer` at line 208) predicts a **much smaller parameter set than you might expect** — just 2 params per stem:
```python
self.num_params = 2
self.param_names = ["Gain dB", "Pan"]
self.min_gain_dB = -48.0
self.max_gain_dB = 24.0
```
Gain: predicted normalized (0,1), denormalized via `restore_from_0to1(gain_dB, -48, 24)`, converted `gain_lin = 10 ** (gain_dB / 20.0)`. Pan: constant-power law via `pan_theta`, `left_gain = cos(theta)`, `right_gain = sin(theta)`, i.e. NOT a simple linear pan — proper equal-power panning. There is no EQ/compressor model in this repo (grepped for `class.*Mixer|EQ|Comp` across `automix/` — only the one `Mixer` class exists); the repo's ambition (per its README, not verified beyond code) is broader but the *actual implemented* differentiable console here only does gain+pan per track. Useful for your mix-metrics design: don't over-scope a "mix critique" feature around a rich per-track EQ/comp parameter vector — the reference implementation you'd cite doesn't have one; gain+pan (loudness balance + stereo placement) is the well-established minimal baseline.

### node-web-audio-api (Tone.js headless pattern)
`examples/tone.js`, fetched verbatim, full file:
```js
// polyfill must be loaded first
import '#node-web-audio-api-polyfill';
import { sleep } from '@ircam/sc-utils';
import * as Tone from 'tone';

const audioContext = new window.AudioContext();
Tone.setContext(audioContext);

const synthA = new Tone.FMSynth().toDestination();
const synthB = new Tone.AMSynth().toDestination();
new Tone.Loop((time) => { synthA.triggerAttackRelease('C2', '8n', time); }, '4n').start(0);
new Tone.Loop((time) => { synthB.triggerAttackRelease('C4', '8n', time); }, '4n').start('8n');
Tone.getTransport().start();
Tone.getTransport().bpm.rampTo(800, 10);

await sleep(10);
process.exit(0);
```
Exact recipe for your CLI render path: (1) import the polyfill package **first** (it patches `globalThis`/`window`), (2) construct `AudioContext` from the polyfilled global (not from `node-web-audio-api` directly — the polyfill installs `window.AudioContext`), (3) `Tone.setContext(audioContext)` before creating any Tone nodes, (4) drive the transport, (5) `process.exit(0)` because Tone.js has no clean node-process teardown (their own comment: "don't understand how to properly stop tone.js, so let's be radical"). This confirms Tone.js-in-Node is a solved, if slightly hacky, problem — plan for an explicit process-exit or a bounded render duration in your CLI rather than expecting graceful shutdown.

---

## What we should directly copy

1. **Graph-of-typed-nodes-with-pointer-fields model** (openDAW's Box/BoxGraph) as the *conceptual* data model — stable UUID per entity, typed/validated references instead of ad-hoc nesting, mandatory-vs-optional pointer rules, cascade-delete via dependency graph. This generalizes cleanly to tracks/clips/notes/devices and gives you free validity checking (`Box.isValid()`).
2. **Declarative per-field parameter metadata**: `{value, min, max, mid, unit, scaling}` colocated with the field definition, one schema feeding both the data model and UI controls (and in their case, codegen for a second language). Directly reusable field-name/range vocabulary from `NoteEventBox`, `AudioUnitBox`, `CompressorDeviceBox` (see §1a).
3. **`ParameterPointerRules`-style "automatable" marker** on fields — makes "can this be automated" a schema-level fact, not scattered UI logic.
4. **Engine/UI separation via a published adapter package** (`studio-adapters`) that both engine and UI import, plus a strict "communicate only via typed RPC messages" boundary — copy this even in-process (module boundary), since it's what makes headless testing free.
5. **Headless-testable engine via a worklet-globals shim + swappable transport** (`worklet-env.ts` + `Communicator`/`Messenger` over `MessageChannel`) — directly informs your `dev:headless`/CLI render design: build your engine so its only "browser" dependency is behind a small interface you can stub in Node exactly like this.
6. **Inverse-update-log undo** (not snapshots): capture graph `Update`s per transaction, store `{forward, inverse}` per step, group multiple ops into one undo step via an explicit `append()`/`mark()` API, and treat a "Modification" as effectively a computed diff — reuse this same object as your diff/dry-run representation.
7. **Resource UUID policy on copy/paste**: `preserved` (content-hash, e.g. audio files) / `internal` (regenerate) / `shared` (regenerate, don't follow edges) as an explicit per-box-type property. Also **content-addressable IDs via SHA-256** for binary assets (dedupes identical samples).
8. **DAWproject vocabulary** — borrow field names directly (`Threshold/Ratio/Attack/Release/Knee/InputGain/OutputGain` for compressor, `Band/Freq/Gain/Q/type` for EQ, `time/duration/contentTimeUnit/playStart/loopStart/loopEnd` for clips) rather than inventing your own; it's already a cross-DAW-agreed vocabulary and openDAW's own exporter proves the mapping is workable from a box-graph model.
9. **`AddressIdEncoder`-style short-ID-for-text-serialization trick** — keep UUIDs canonical internally, mint short sequential/human IDs only at the text-serialization boundary if you need shorter diff-friendly references (though see below — better to just use the UUID's short prefix or a human slug directly).
10. **Tone.js-in-Node exact incantation** (`#node-web-audio-api-polyfill` import order, `Tone.setContext`, explicit `process.exit`) for your CLI's audio render path.

## What we should deliberately do differently

1. **Text/JSON as the canonical format, not a zip of a custom binary blob.** openDAW's `project.od` is a bespoke binary format (magic header + numeric field keys + length-prefixed byte blobs) chosen so Rust and TS engines can byte-checksum each other — a driver that doesn't apply to us. We should make the canonical project file itself JSON (or YAML/TOML) with **named fields**, not numeric keys, so `git diff` is meaningful. openDAW's own `toJSON()` even betrays the wrong instinct here: it serializes numeric FieldKeys (`"1": ..., "20": true`) instead of names — don't replicate that; always round-trip through the human field name.
2. **No zip wrapper for the primary document.** openDAW bundles code+samples+metadata into one opaque `.odb` zip. For diff-friendliness, keep the project *document* (tracks/clips/notes/devices/automation) as one plain-text file (or a directory of them) and reference external binary assets (audio samples) by path/hash **outside** any archive, the way a normal git repo would — zip actively defeats `git diff`/`git blame`/PR review, which is the whole point of our differentiator.
3. **Human-readable, stable, order-independent IDs where feasible.** openDAW's raw-random UUIDs (`crypto.getRandomValues`) are fine for internal identity but ugly in diffs and hard to hand-author/hand-edit via CLI/agent. Consider short human-assignable slugs (like DAWproject's `xs:ID`/`IDREF` strings, e.g. `track-kick`, `clip-verse-1`) as the *primary* text-format identifier, keeping a UUID (or just using the slug itself) only where global uniqueness truly matters (e.g. content-addressable sample refs). This also makes diffs/PRs from an AI agent legible to a human reviewer without a UUID-to-name lookup step.
4. **Automation targets by stable path/name, not opaque pointer-to-field-address.** openDAW targets automation at a `Field`'s `Address` (uuid + numeric field-key path) — resolvable only by walking the schema. For text-diff-friendliness, target automation with something like `track:kick.device:compressor.threshold` (dotted human path) so a diff of "which parameter is now automated" is self-explanatory without cross-referencing a schema.
5. **Don't over-scope per-track EQ/compressor mix-critique modeling** on the assumption that "DMC" already does that — the actual reference implementation (automix-toolkit) only models gain+pan. If you want EQ/comp-aware mix critique, that's a step beyond current published differentiable-mixing prior art, not something to borrow wholesale.
6. **Keep the field-numbering-for-binary-compactness optimization out of the canonical file entirely.** If you ever want a compact binary form for fast engine loading (analogous to openDAW's rationale), treat it purely as a *derived/cache* artifact (like a lockfile or build output), never checked into version control, generated from the canonical text file — so the diff-friendly text file remains the single source of truth and the binary form is disposable.
